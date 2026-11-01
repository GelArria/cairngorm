//! Project-local read authorization. The gateway must still supply consent and a live caller.
use super::file_handles;
#[cfg(windows)]
use std::path::Component;
use std::{
    io::Read,
    path::{Path, PathBuf},
};

const MAX_SNAPSHOT_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug)]
pub(super) struct FileError {
    pub code: &'static str,
    pub message: String,
}
impl FileError {
    pub(super) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub(super) struct ProjectScope {
    root: file_handles::PinnedFile,
    path: PathBuf,
}

pub(super) struct AuthorizedFile {
    file: file_handles::PinnedFile,
    pub path: PathBuf,
}

pub(super) struct FileSnapshot {
    pub path: PathBuf,
    pub bytes: Vec<u8>,
}

impl ProjectScope {
    pub fn new(root: &Path) -> Result<Self, FileError> {
        validate_path(root)?;
        if !root.is_absolute() {
            return Err(FileError::new(
                "missing-scope",
                "File access requires a project folder.",
            ));
        }
        let file = file_handles::open(root, true).map_err(io_error)?;
        let path = file_handles::path(&file).map_err(io_error)?;
        validate_path(&path)?;
        Ok(Self { root: file, path })
    }

    pub fn resolve(&self, requested: &str) -> Result<PathBuf, FileError> {
        validate_path(Path::new(requested))?;
        let path = align(normalize(&self.path.join(requested))?, &self.path);
        validate_path(&path)?;
        Ok(path)
    }

    pub fn root_path(&self) -> &Path {
        &self.path
    }

    pub fn open_read(&self, requested: &str) -> Result<AuthorizedFile, FileError> {
        self.open_path(requested, false)
    }

    /// A folder inside the project, opened and checked like a read.
    pub fn open_directory(&self, requested: &str) -> Result<AuthorizedFile, FileError> {
        self.open_path(requested, true)
    }

    pub fn list(&self, requested: &str) -> Result<serde_json::Value, FileError> {
        let directory = self.open_path(requested, true)?;
        let mut entries = Vec::new();
        let mut truncated = false;
        for entry in file_handles::entries(&directory.file).map_err(io_error)? {
            let entry = entry.map_err(|e| io_error(e.to_string()))?;
            if entries.len() == 1000 {
                truncated = true;
                break;
            }
            let kind = entry.file_type().map_err(|e| io_error(e.to_string()))?;
            entries.push(serde_json::json!({
                "name": entry.file_name().to_string_lossy(),
                "path": directory.path.join(entry.file_name()).to_string_lossy(),
                "isDirectory": kind.is_dir(), "size": null,
            }));
        }
        entries.sort_by_cached_key(|e| {
            (
                !e["isDirectory"].as_bool().unwrap_or(false),
                e["name"].as_str().unwrap_or_default().to_lowercase(),
            )
        });
        Ok(serde_json::json!({"path": directory.path, "entries": entries, "truncated": truncated}))
    }

    fn open_path(&self, requested: &str, directory: bool) -> Result<AuthorizedFile, FileError> {
        self.check_root()?;
        let canonical = self.resolve(requested)?;
        if !canonical.starts_with(&self.path) {
            return Err(unauthorized());
        }
        let file = file_handles::open(&canonical, directory).map_err(io_error)?;
        let path = file_handles::path(&file).map_err(io_error)?;
        validate_path(&path)?;
        self.check_root()?;
        if !path.starts_with(&self.path) {
            return Err(unauthorized());
        }
        Ok(AuthorizedFile { file, path })
    }

    fn check_root(&self) -> Result<(), FileError> {
        if file_handles::path(&self.root).map_err(io_error)? != self.path {
            return Err(FileError::new(
                "scope-changed",
                "The project folder changed. File access was revoked.",
            ));
        }
        Ok(())
    }
}

impl AuthorizedFile {
    pub fn snapshot(self, limit: usize) -> Result<FileSnapshot, FileError> {
        let limit = limit.min(MAX_SNAPSHOT_BYTES);
        let mut bytes = Vec::new();
        self.file
            .file
            .take(limit.saturating_add(1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|e| io_error(e.to_string()))?;
        if bytes.len() > limit {
            return Err(FileError::new(
                "file-too-large",
                "The file exceeds the allowed size.",
            ));
        }
        Ok(FileSnapshot {
            path: self.path,
            bytes,
        })
    }
}

fn normalize(path: &Path) -> Result<PathBuf, FileError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err(unauthorized());
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
}

/// Writes an absolute path in the root's form: Windows reports the root as `\\?\C:\...` and
/// paths compare case-insensitively, so `c:\Proj\a.xlsx` must still be inside `\\?\C:\proj`.
fn align(path: PathBuf, root: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        const VERBATIM: &str = r"\\?\";
        let text = path.to_string_lossy().into_owned();
        let root_text = root.to_string_lossy().into_owned();
        let plain = text.strip_prefix(VERBATIM).unwrap_or(&text);
        let plain_root = root_text.strip_prefix(VERBATIM).unwrap_or(&root_text);
        let inside = plain.get(..plain_root.len()).is_some_and(|head| {
            head.eq_ignore_ascii_case(plain_root)
                && matches!(plain.as_bytes().get(plain_root.len()), None | Some(b'\\'))
        });
        if inside {
            return PathBuf::from(format!("{root_text}{}", &plain[plain_root.len()..]));
        }
        if root_text.starts_with(VERBATIM) && !text.starts_with(VERBATIM) && path.is_absolute() {
            return PathBuf::from(format!("{VERBATIM}{text}"));
        }
    }
    #[cfg(not(windows))]
    let _ = root;
    path
}

fn unauthorized() -> FileError {
    FileError::new("not-authorized", "File access was not authorized.")
}
fn io_error(message: String) -> FileError {
    FileError::new("file-unavailable", message)
}

fn validate_path(path: &Path) -> Result<(), FileError> {
    let invalid = || FileError::new("invalid-path", "Only local file paths are supported.");
    let text = path.as_os_str().to_string_lossy();
    if text.is_empty() || text.chars().any(|c| c == '\0' || c == '\r' || c == '\n') {
        return Err(invalid());
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if path.has_root() && !path.is_absolute() {
            return Err(invalid());
        }
        for component in path.components() {
            match component {
                Component::Prefix(prefix)
                    if !matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) =>
                {
                    return Err(invalid())
                }
                Component::Prefix(_) if !path.is_absolute() => return Err(invalid()),
                Component::Normal(name) => {
                    let name = name.to_string_lossy();
                    let base = name
                        .split('.')
                        .next()
                        .unwrap_or_default()
                        .trim_end_matches(' ')
                        .to_ascii_uppercase();
                    if name.contains(':')
                        || name.ends_with([' ', '.'])
                        || matches!(
                            base.as_str(),
                            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                        )
                        || ["COM", "LPT"].iter().any(|prefix| {
                            base.strip_prefix(prefix).is_some_and(|n| {
                                matches!(
                                    n,
                                    "1" | "2"
                                        | "3"
                                        | "4"
                                        | "5"
                                        | "6"
                                        | "7"
                                        | "8"
                                        | "9"
                                        | "¹"
                                        | "²"
                                        | "³"
                                )
                            })
                        })
                    {
                        return Err(invalid());
                    }
                }
                _ => {}
            }
        }
    }
    #[cfg(not(windows))]
    {
        if text.starts_with("//") {
            return Err(invalid());
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_file_scope.rs"]
mod tests;
