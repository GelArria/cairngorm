//! `cairngorm_create_file`: a new document from its provider's blank template, created inside
//! the terminal's project folder (never overwriting) and opened in a pane like
//! `cairngorm_open_file`.
use super::{
    file_runtime::Scope,
    file_scope::{AuthorizedFile, FileError, ProjectScope},
};
use serde_json::Value;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

type Template = dyn Fn(&str) -> Result<(Vec<u8>, String), String>;

pub(super) fn create(scope: &Arc<Scope>, requested: &str) -> Result<Value, FileError> {
    let authorized = || super::files::still_authorized(scope);
    let (path, provider) = write_new(
        &scope.root,
        requested,
        &crate::documents::document_template,
        &authorized,
    )?;
    let shown = path
        .to_str()
        .ok_or_else(|| FileError::new("invalid-path", "The path is not Unicode."))?;
    let snapshot = scope.root.open_read(shown)?.snapshot(25 * 1024 * 1024)?;
    authorized()?;
    let mut opened = crate::documents::request_open(
        &scope.metadata.project_id,
        &scope.metadata.session_id,
        &snapshot.path.to_string_lossy(),
        snapshot.bytes,
    )
    .map_err(|error| {
        FileError::new(
            "open-failed",
            format!("{shown} was created but could not be shown: {error}. Open it with cairngorm_open_file."),
        )
    })?;
    opened["created"] = Value::Bool(true);
    opened["provider"] = Value::String(provider);
    Ok(opened)
}

/// Writes the template to a new file; returns its path and the provider that opens it.
pub(super) fn write_new(
    root: &ProjectScope,
    requested: &str,
    template: &Template,
    authorized: &dyn Fn() -> Result<(), FileError>,
) -> Result<(PathBuf, String), FileError> {
    let path = root.resolve(requested)?;
    if !path.starts_with(root.root_path()) || path == root.root_path() {
        return Err(FileError::new(
            "outside-project",
            "New files can only be created inside this terminal's project folder.",
        ));
    }
    let invalid = |message: &str| FileError::new("invalid-path", message.to_string());
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| invalid("The path needs a file name."))?;
    let extension = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| invalid("The file name needs an extension, such as .xlsx."))?;
    let (bytes, provider) = template(extension).map_err(|e| FileError::new("no-template", e))?;
    let directory = ensure_directory(root, path.parent().unwrap_or(root.root_path()))?;
    authorized()?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.path.join(name))
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => FileError::new(
                "already-exists",
                format!("{name} already exists. Open it with cairngorm_open_file instead."),
            ),
            _ => FileError::new("create-failed", e.to_string()),
        })?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| FileError::new("create-failed", e.to_string()))?;
    Ok((path, provider))
}

/// The parent folder, created when missing. The deepest existing folder is opened (and so
/// checked to be inside the project) before anything is created below it.
fn ensure_directory(root: &ProjectScope, parent: &Path) -> Result<AuthorizedFile, FileError> {
    let invalid = || FileError::new("invalid-path", "Invalid folder.");
    let mut existing = parent;
    let mut missing = Vec::new();
    while !existing.is_dir() {
        missing.push(existing.file_name().ok_or_else(invalid)?);
        existing = existing.parent().ok_or_else(invalid)?;
    }
    if missing.len() > 8 {
        return Err(FileError::new(
            "invalid-path",
            "Too many new folders in one path.",
        ));
    }
    let text = |path: &Path| path.to_str().map(str::to_string).ok_or_else(invalid);
    // Each folder is opened and checked inside the project before anything goes below it,
    // so a folder swapped for a link meanwhile is refused instead of followed.
    let mut opened = root.open_directory(&text(existing)?)?;
    for name in missing.into_iter().rev() {
        let next = opened.path.join(name);
        if let Err(error) = std::fs::create_dir(&next) {
            if error.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(FileError::new("create-failed", error.to_string()));
            }
        }
        opened = root.open_directory(&text(&next)?)?;
    }
    Ok(opened)
}

#[cfg(all(test, windows))]
#[path = "../../../tests/native/plugin_file_create.rs"]
mod tests;
