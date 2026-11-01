//! Document provider manifests (`cairngorm-provider.json`): untrusted input, validated strictly.
//! Unknown fields are refused so a future permission can never be silently ignored.
use serde::Serialize;
use serde_json::{Map, Value};

pub const MANIFEST_FILE: &str = "cairngorm-provider.json";
pub const PROTOCOL: &str = "cairngorm.document-provider/1";
/// Largest document any provider may receive; snapshots travel through IPC and postMessage.
pub const HOST_MAX_BYTES: u64 = 32 * 1024 * 1024;
const DEFAULT_MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 64 * 1024;
/// "view" is required; "edit" lets the provider hand back bytes that Cairngorm saves.
const CAPABILITIES: &[&str] = &["view", "edit"];
const FIELDS: &[&str] = &[
    "protocol",
    "id",
    "name",
    "version",
    "description",
    "entry",
    "fileTypes",
    "capabilities",
    "maxBytes",
    "permissions",
    "operations",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileType {
    pub label: String,
    pub extensions: Vec<String>,
    pub mime_types: Vec<String>,
    /// A blank document inside the bundle, copied when an agent creates a new file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub entry: String,
    pub file_types: Vec<FileType>,
    pub capabilities: Vec<String>,
    pub max_bytes: u64,
    pub operations: Vec<super::operations::Operation>,
}

pub fn parse(bytes: &[u8]) -> Result<Manifest, String> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(format!("{MANIFEST_FILE} is larger than 64 KiB."));
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|e| format!("{MANIFEST_FILE} is not valid JSON: {e}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| format!("{MANIFEST_FILE} must be a JSON object."))?;
    if let Some(key) = object.keys().find(|key| !FIELDS.contains(&key.as_str())) {
        return Err(format!("Unsupported manifest field \"{key}\"."));
    }
    let protocol = text(object, "protocol", 64)?;
    if protocol != PROTOCOL {
        return Err(format!(
            "Unsupported provider protocol \"{protocol}\". This Cairngorm supports \"{PROTOCOL}\"."
        ));
    }
    let id = text(object, "id", 64)?;
    if !valid_id(&id) {
        return Err(
            "Provider id must be lowercase reverse-DNS, such as \"com.example.viewer\".".into(),
        );
    }
    if id.starts_with("cairngorm.") {
        return Err("Provider ids starting with \"cairngorm.\" are reserved.".into());
    }
    let version = text(object, "version", 32)?;
    if !valid_version(&version) {
        return Err("Provider version must look like 1.2.3.".into());
    }
    if let Some(permissions) = object.get("permissions") {
        if permissions.as_array().is_none_or(|list| !list.is_empty()) {
            return Err(
                "This Cairngorm grants no provider permissions; \"permissions\" must be empty."
                    .into(),
            );
        }
    }
    let max_bytes = match object.get("maxBytes") {
        None => DEFAULT_MAX_BYTES,
        Some(value) => value
            .as_u64()
            .filter(|bytes| (1..=HOST_MAX_BYTES).contains(bytes))
            .ok_or("maxBytes must be a whole number of bytes up to 32 MiB.")?,
    };
    Ok(Manifest {
        name: text(object, "name", 64)?,
        description: optional_text(object, "description", 280)?,
        entry: entry(object)?,
        file_types: super::file_types::file_types(object)?,
        capabilities: capabilities(object)?,
        operations: super::operations::operations(object)?,
        max_bytes,
        id,
        version,
    })
}

pub(super) fn text(object: &Map<String, Value>, key: &str, max: usize) -> Result<String, String> {
    optional_text(object, key, max)?.ok_or_else(|| format!("Manifest field \"{key}\" is required."))
}

fn optional_text(
    object: &Map<String, Value>,
    key: &str,
    max: usize,
) -> Result<Option<String>, String> {
    let Some(value) = object.get(key) else {
        return Ok(None);
    };
    let value = value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().count() <= max)
        .filter(|value| !value.chars().any(char::is_control))
        .ok_or_else(|| {
            format!("Manifest field \"{key}\" must be text of at most {max} characters.")
        })?;
    Ok(Some(value.to_string()))
}

fn valid_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && !part.starts_with('-')
                && part
                    .bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        })
}

fn valid_version(version: &str) -> bool {
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let numbers: Vec<&str> = core.split('.').collect();
    numbers.len() == 3
        && numbers
            .iter()
            .all(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()))
        && version
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'+'))
}

/// A relative HTML page inside the bundle; resolved again when served.
fn entry(object: &Map<String, Value>) -> Result<String, String> {
    let entry = text(object, "entry", 200)?;
    let safe =
        entry.ends_with(".html") && !entry.starts_with('/') && entry.split('/').all(valid_segment);
    if !safe {
        return Err("\"entry\" must be a relative .html path inside the provider folder.".into());
    }
    Ok(entry)
}

/// One path component of a served or copied bundle file.
pub fn valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment.starts_with('.')
        && segment.len() <= 128
        && !segment
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}

pub(super) fn strings(object: &Map<String, Value>, key: &str) -> Result<Vec<String>, String> {
    object
        .get(key)
        .and_then(Value::as_array)
        .filter(|list| list.len() <= 16)
        .and_then(|list| list.iter().map(|v| v.as_str().map(String::from)).collect())
        .ok_or_else(|| format!("\"{key}\" must be a list of at most 16 strings."))
}

fn capabilities(object: &Map<String, Value>) -> Result<Vec<String>, String> {
    let list = strings(object, "capabilities")?;
    if !list.iter().any(|c| c == "view") {
        return Err("\"capabilities\" must include \"view\".".into());
    }
    if let Some(other) = list.iter().find(|c| !CAPABILITIES.contains(&c.as_str())) {
        return Err(format!(
            "Capability \"{other}\" is not supported. Providers may declare \"view\" and \"edit\"."
        ));
    }
    let mut granted = vec!["view".to_string()];
    if list.iter().any(|c| c == "edit") {
        granted.push("edit".into());
    }
    Ok(granted)
}

#[cfg(test)]
#[path = "../../../tests/native/document_manifest.rs"]
mod tests;
