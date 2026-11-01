//! Document providers: approved third-party viewers hosted in isolated panes, plus the
//! bounded snapshot reads that feed every document pane (built-in or installed).
#[path = "./document_bundle.rs"]
mod bundle;
#[path = "./document_bundled.rs"]
mod bundled;
#[path = "./document_create.rs"]
mod create;
#[path = "./document_file_types.rs"]
mod file_types;
#[path = "./document_install.rs"]
mod install;
#[path = "./document_manifest.rs"]
mod manifest;
#[path = "./document_open.rs"]
mod open;
#[path = "./document_operations.rs"]
mod operations;
#[path = "./document_origins.rs"]
mod origins;
#[path = "./document_requests.rs"]
mod requests;
#[path = "./document_serve.rs"]
mod serve;
#[path = "./document_tickets.rs"]
mod tickets;
#[path = "./document_write.rs"]
mod write;

// Glob export: Tauri command macros generate hidden companion items.
pub use create::template as document_template;
pub use open::*;
pub use origins::is_document_origin;
pub use serve::Response;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::{AppHandle, Emitter, Manager};
pub use write::*;

static ROOT: OnceLock<PathBuf> = OnceLock::new();

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(root) = ROOT.get() {
        return Ok(root.clone());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("document-providers");
    origins::set_salt(origin_salt(&root));
    Ok(ROOT.get_or_init(|| root).clone())
}

/// Created once per install and kept, so provider storage origins stay stable across runs.
fn origin_salt(root: &Path) -> String {
    let path = root.join(".origin-salt");
    if let Ok(salt) = fs::read_to_string(&path) {
        if salt.len() == 32 && salt.bytes().all(|c| c.is_ascii_hexdigit()) {
            return salt;
        }
    }
    let salt = uuid::Uuid::new_v4().simple().to_string();
    let _ = fs::create_dir_all(root).and_then(|()| fs::write(&path, &salt));
    salt
}

/// Called by the gateway for every request; `None` leaves non-document hosts to it.
/// Document hosts are always answered here, with 404 before any pane set the data folder.
pub fn serve_request(
    gateway: &str,
    method: &str,
    path: &str,
    host: Option<&str>,
) -> Option<Response> {
    serve::serve(
        ROOT.get().map(PathBuf::as_path),
        gateway,
        method,
        path,
        host,
    )
}

#[tauri::command]
pub async fn document_providers_list(app: AppHandle) -> Result<Vec<install::Installed>, String> {
    let root = root(&app)?;
    let (changed, listed) = crate::blocking(move || {
        let changed = bundled::refresh_once(&root);
        (changed, install::list(&root))
    })
    .await?;
    if changed {
        let _ = app.emit("document-providers-changed", ());
    }
    Ok(listed)
}

/// Bundled ids are reserved: a folder the user picks can never pose as one.
fn user_inspection(root: &Path, path: &Path) -> Result<install::Inspection, String> {
    let reviewed = install::inspect(root, path)?;
    if bundled::reserved(&reviewed.manifest.id) {
        return Err(format!(
            "\"{}\" is reserved for providers included with Cairngorm.",
            reviewed.manifest.id
        ));
    }
    Ok(reviewed)
}

#[tauri::command]
pub async fn document_provider_inspect(
    app: AppHandle,
    path: String,
) -> Result<install::Inspection, String> {
    let root = root(&app)?;
    crate::blocking(move || user_inspection(&root, Path::new(&path))).await?
}

#[tauri::command]
pub async fn document_provider_install(
    app: AppHandle,
    path: String,
    approval_hash: String,
) -> Result<manifest::Manifest, String> {
    let root = root(&app)?;
    let installed = crate::blocking(move || {
        let reviewed = user_inspection(&root, Path::new(&path))?;
        if reviewed.approval_hash != approval_hash {
            return Err("The provider changed after it was reviewed. Review it again.".into());
        }
        install::install(&root, Path::new(&path), &approval_hash)
    })
    .await??;
    // Origins stay registered: panes already showing this provider keep loading its files.
    let _ = app.emit("document-providers-changed", ());
    Ok(installed)
}

/// Providers shipped inside Cairngorm, with whether each is installed.
#[tauri::command]
pub async fn document_providers_bundled(app: AppHandle) -> Result<Vec<bundled::Bundled>, String> {
    let root = root(&app)?;
    crate::blocking(move || bundled::list(&root)).await
}

/// One click in Settings: the user's choice is the approval for a bundle Cairngorm ships.
#[tauri::command]
pub async fn document_provider_install_bundled(
    app: AppHandle,
    name: String,
) -> Result<manifest::Manifest, String> {
    let root = root(&app)?;
    let installed = crate::blocking(move || bundled::install_bundled(&root, &name)).await??;
    let _ = app.emit("document-providers-changed", ());
    Ok(installed)
}

#[tauri::command]
pub async fn document_provider_remove(app: AppHandle, id: String) -> Result<(), String> {
    let root = root(&app)?;
    let provider = id.clone();
    crate::blocking(move || {
        install::remove(&root, &provider)?;
        // Removing an included provider is a choice: it is not reinstalled on the next start.
        if bundled::reserved(&provider) {
            bundled::set_removed(&root, &provider, true);
        }
        Ok::<_, String>(())
    })
    .await??;
    origins::forget_provider(&id);
    let _ = app.emit("document-providers-changed", ());
    Ok(())
}

/// The isolated page URL for one provider in one project scope.
#[tauri::command]
pub async fn document_view_url(
    app: AppHandle,
    provider: String,
    scope: String,
) -> Result<String, String> {
    let root = root(&app)?;
    let lookup = provider.clone();
    let manifest = crate::blocking(move || install::approved(&root, &lookup))
        .await?
        .ok_or("This document provider is not installed or approved.")?;
    if scope.len() > 512 {
        return Err("Invalid project scope.".into());
    }
    let gateway = crate::plugins::gateway_origin(&app)?;
    let origin = origins::view_origin(&gateway, &provider, &scope);
    // The pane loads Cairngorm's relay frame, which loads the provider entry on its sibling origin.
    Ok(format!(
        "{origin}/_cairngorm/frame.html?entry={}",
        query_value(&manifest.entry)
    ))
}

fn query_value(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The bytes a provider renders, refused above its declared limit before reading them.
#[tauri::command]
pub async fn document_read_snapshot(
    path: String,
    max_bytes: u64,
) -> Result<tauri::ipc::Response, String> {
    let bytes = crate::blocking(move || read_snapshot(Path::new(&path), max_bytes)).await??;
    Ok(tauri::ipc::Response::new(bytes))
}

pub fn read_snapshot(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let limit = max_bytes.clamp(1, manifest::HOST_MAX_BYTES);
    let too_large = || {
        format!(
            "The document is too large to open ({} MiB maximum).",
            limit.div_ceil(1024 * 1024)
        )
    };
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        return Err("This is a folder, not a document.".into());
    }
    if metadata.len() > limit {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(too_large());
    }
    Ok(bytes)
}

#[cfg(test)]
#[path = "../../../tests/native/document_snapshot.rs"]
mod snapshot_tests;
