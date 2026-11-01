//! Host-owned saving for editable providers. A provider only hands bytes back; Cairngorm checks
//! the version it opened, keeps a backup, writes a sibling temporary file and replaces the
//! original in one rename. Any failure leaves the original untouched.
use super::manifest::HOST_MAX_BYTES;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

/// Newest backups kept per document, and in total across documents.
const BACKUPS_PER_FILE: usize = 5;
const MAX_BACKUPS: usize = 200;

#[derive(Debug, PartialEq)]
pub enum WriteError {
    /// The file on disk is not the version the provider edited.
    Conflict,
    /// Another program holds the file open without sharing it.
    InUse,
    Other(String),
}

impl WriteError {
    pub fn message(&self) -> String {
        match self {
            Self::Conflict => "The file changed on disk since it was opened. Reload it before saving; your edits were not written.".into(),
            Self::InUse => "Another program has this file open, or it cannot be replaced here. Close it there and save again; the original was not changed.".into(),
            Self::Other(error) => format!("Could not save: {error}. The original was not changed."),
        }
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn current_version(path: &Path) -> Result<String, WriteError> {
    let metadata = fs::metadata(path).map_err(|e| WriteError::Other(e.to_string()))?;
    if !metadata.is_file() || metadata.len() > HOST_MAX_BYTES {
        return Err(WriteError::Other(
            "not a document Cairngorm can save".into(),
        ));
    }
    Ok(digest(
        &fs::read(path).map_err(|e| WriteError::Other(e.to_string()))?,
    ))
}

fn is_in_use(error: &std::io::Error) -> bool {
    // Windows: replacing a file another program holds without delete sharing reports
    // ERROR_ACCESS_DENIED (5); reading or copying it reports sharing/lock violations (32/33).
    matches!(error.raw_os_error(), Some(5 | 32 | 33))
}

/// Replaces `path` with `bytes` if it still has `expected` content. Returns the new version.
pub fn write(
    path: &Path,
    expected: &str,
    bytes: &[u8],
    backups: &Path,
) -> Result<String, WriteError> {
    if bytes.len() as u64 > HOST_MAX_BYTES {
        return Err(WriteError::Other(
            "the document is larger than 32 MiB".into(),
        ));
    }
    let _lock = crate::fs_cmds::WRITE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    // A link is followed to the file it names: that file is replaced, never the link itself.
    let canonical = fs::canonicalize(path).map_err(|e| WriteError::Other(e.to_string()))?;
    let path = canonical.as_path();
    if current_version(path)? != expected {
        return Err(WriteError::Conflict);
    }
    backup(path, backups)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temporary = path.with_file_name(format!(
        ".{name}.cairngorm-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| WriteError::Other(e.to_string()))?;
        file.write_all(bytes)
            .map_err(|e| WriteError::Other(e.to_string()))?;
        file.sync_all()
            .map_err(|e| WriteError::Other(e.to_string()))?;
        drop(file);
        // Checked again right before the swap: an edit made meanwhile is never overwritten.
        if current_version(path)? != expected {
            return Err(WriteError::Conflict);
        }
        fs::rename(&temporary, path).map_err(|e| {
            if is_in_use(&e) {
                WriteError::InUse
            } else {
                WriteError::Other(e.to_string())
            }
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|()| digest(bytes))
}

/// The pre-save original, kept privately: the newest few per document and a bounded total, so
/// saving one document often never evicts every other document's backups.
fn backup(path: &Path, backups: &Path) -> Result<PathBuf, WriteError> {
    fs::create_dir_all(backups).map_err(|e| WriteError::Other(e.to_string()))?;
    // Short names keep backup paths well inside Windows path limits.
    let name: String = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
        .chars()
        .rev()
        .take(60)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let document = &digest(path.to_string_lossy().to_lowercase().as_bytes())[..12];
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let target = backups.join(format!("{stamp:015}-{document}-{name}"));
    fs::copy(path, &target).map_err(|e| {
        if is_in_use(&e) {
            WriteError::InUse
        } else {
            WriteError::Other(e.to_string())
        }
    })?;
    let mut existing: Vec<_> = fs::read_dir(backups)
        .map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()).collect())
        .unwrap_or_default();
    // Names start with a zero-padded timestamp, so sorting is oldest first.
    existing.sort();
    let tag = format!("-{document}-");
    let mine: Vec<_> = existing
        .iter()
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().contains(&tag))
        })
        .cloned()
        .collect();
    for old in mine
        .iter()
        .take(mine.len().saturating_sub(BACKUPS_PER_FILE))
    {
        let _ = fs::remove_file(old);
    }
    let remaining: Vec<_> = existing.into_iter().filter(|p| p.exists()).collect();
    for old in remaining
        .iter()
        .take(remaining.len().saturating_sub(MAX_BACKUPS))
    {
        let _ = fs::remove_file(old);
    }
    Ok(target)
}

#[cfg(test)]
#[path = "../../../tests/native/document_write.rs"]
mod tests;

/// Raw IPC body (the provider's bytes) with `x-document-path` (percent-encoded) and
/// `x-document-version` headers, so large documents never pass through JSON.
#[tauri::command]
pub async fn document_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    use tauri::Manager;
    super::open::require_document_window(&window)?;
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let path = header("x-document-path")
        .and_then(|encoded| super::serve::percent_decode(&encoded))
        .ok_or("Missing document path.")?;
    let expected = header("x-document-version").ok_or("Missing document version.")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the document bytes.".into());
    };
    let bytes = bytes.clone();
    let backups = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("document-backups");
    crate::blocking(move || write(Path::new(&path), &expected, &bytes, &backups))
        .await?
        .map_err(|error| error.message())
}
