//! The `fileTypes` section of a provider manifest.
use super::manifest::{strings, text, FileType};
use serde_json::{Map, Value};

const MAX_FILE_TYPES: usize = 16;
const MAX_EXTENSIONS: usize = 32;
/// Files Cairngorm already edits as text, code or notebooks. A provider claiming them would
/// silently turn editable files into read-only views, so these are refused.
const RESERVED: &[&str] = &[
    "txt",
    "md",
    "markdown",
    "ipynb",
    "json",
    "jsonc",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "env",
    "log",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "less",
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "mts",
    "cts",
    "tsx",
    "py",
    "rs",
    "go",
    "java",
    "kt",
    "c",
    "h",
    "cpp",
    "hpp",
    "cs",
    "rb",
    "php",
    "swift",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "bat",
    "cmd",
    "sql",
    "lua",
    "vue",
    "svelte",
    "gitignore",
    "editorconfig",
    "lock",
];

pub fn file_types(object: &Map<String, Value>) -> Result<Vec<FileType>, String> {
    let list = object
        .get("fileTypes")
        .and_then(Value::as_array)
        .filter(|list| !list.is_empty() && list.len() <= MAX_FILE_TYPES)
        .ok_or("\"fileTypes\" must list between 1 and 16 file types.")?;
    let mut seen = Vec::new();
    let mut types = Vec::new();
    for item in list {
        let item = item
            .as_object()
            .ok_or("Each file type must be an object.")?;
        if let Some(key) = item.keys().find(|key| {
            !matches!(
                key.as_str(),
                "label" | "extensions" | "mimeTypes" | "template"
            )
        }) {
            return Err(format!("Unsupported file type field \"{key}\"."));
        }
        let mut extensions = Vec::new();
        for value in strings(item, "extensions")? {
            let extension = value.trim_start_matches('.').to_ascii_lowercase();
            if !valid_extension(&extension) {
                return Err(format!("\"{value}\" is not a valid file extension."));
            }
            if RESERVED.contains(&extension.as_str()) {
                return Err(format!(
                    "\".{extension}\" files are edited as text in Cairngorm and cannot be taken over by a provider."
                ));
            }
            if seen.contains(&extension) {
                return Err(format!("Extension \"{extension}\" is declared twice."));
            }
            seen.push(extension.clone());
            extensions.push(extension);
        }
        if extensions.is_empty() {
            return Err("Each file type needs at least one extension.".into());
        }
        let mime_types = if item.contains_key("mimeTypes") {
            strings(item, "mimeTypes")?
        } else {
            Vec::new()
        };
        if let Some(bad) = mime_types.iter().find(|m| !valid_mime(m)) {
            return Err(format!("\"{bad}\" is not a valid MIME type."));
        }
        let template = match item.get("template") {
            None => None,
            Some(_) => {
                let path = text(item, "template", 200)?;
                if path.starts_with('/') || !path.split('/').all(super::manifest::valid_segment) {
                    return Err(
                        "\"template\" must be a relative path inside the provider folder.".into(),
                    );
                }
                Some(path)
            }
        };
        types.push(FileType {
            label: text(item, "label", 48)?,
            template,
            extensions,
            mime_types: mime_types
                .into_iter()
                .map(|m| m.to_ascii_lowercase())
                .collect(),
        });
    }
    if seen.len() > MAX_EXTENSIONS {
        return Err("A provider may declare at most 32 extensions.".into());
    }
    Ok(types)
}

fn valid_extension(extension: &str) -> bool {
    (1..=16).contains(&extension.len())
        && extension
            .bytes()
            .next()
            .is_some_and(|c| c.is_ascii_alphanumeric())
        && extension.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'-' | b'+')
        })
}

fn valid_mime(mime: &str) -> bool {
    let Some((kind, subtype)) = mime.split_once('/') else {
        return false;
    };
    let token = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'+' | b'_'))
    };
    mime.len() <= 100 && token(kind) && token(subtype)
}
