//! The optional `operations` section of a provider manifest: named, typed actions an agent can
//! run on an open document through Cairngorm. The provider implements them in its view; there
//! is no way to declare arbitrary code, commands or file access.
use serde::Serialize;
use serde_json::{Map, Value};

const MAX_OPERATIONS: usize = 16;
const MAX_SCHEMA_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub name: String,
    pub description: String,
    /// JSON Schema of the arguments object, shown to agents; the provider validates input.
    pub input_schema: Value,
}

pub fn operations(object: &Map<String, Value>) -> Result<Vec<Operation>, String> {
    let Some(value) = object.get("operations") else {
        return Ok(Vec::new());
    };
    let list = value
        .as_array()
        .filter(|list| list.len() <= MAX_OPERATIONS)
        .ok_or("\"operations\" must list at most 16 operations.")?;
    let mut seen: Vec<String> = Vec::new();
    let mut operations = Vec::new();
    for item in list {
        let item = item
            .as_object()
            .ok_or("Each operation must be an object.")?;
        if let Some(key) = item
            .keys()
            .find(|key| !matches!(key.as_str(), "name" | "description" | "inputSchema"))
        {
            return Err(format!("Unsupported operation field \"{key}\"."));
        }
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| valid_name(name))
            .ok_or(
                "Operation names must be lowercase words joined by hyphens, such as \"set-field\".",
            )?
            .to_string();
        if seen.contains(&name) {
            return Err(format!("Operation \"{name}\" is declared twice."));
        }
        seen.push(name.clone());
        let description = item
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty() && text.chars().count() <= 300)
            .filter(|text| !text.chars().any(char::is_control))
            .ok_or_else(|| {
                format!("Operation \"{name}\" needs a description of at most 300 characters.")
            })?
            .to_string();
        let input_schema = item
            .get("inputSchema")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "type": "object" }));
        let object_schema = input_schema
            .as_object()
            .is_some_and(|schema| schema["type"] == "object");
        if !object_schema || input_schema.to_string().len() > MAX_SCHEMA_BYTES {
            return Err(format!(
                "Operation \"{name}\" needs an object \"inputSchema\" of at most 8 KiB."
            ));
        }
        operations.push(Operation {
            name,
            description,
            input_schema,
        });
    }
    Ok(operations)
}

fn valid_name(name: &str) -> bool {
    (1..=48).contains(&name.len())
        && name.bytes().next().is_some_and(|c| c.is_ascii_lowercase())
        && name
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && !name.ends_with('-')
}
