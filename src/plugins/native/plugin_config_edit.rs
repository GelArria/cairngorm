//! Format-preserving registration edits: user configs keep their comments, order and style.
//! Every edit is re-parsed before it is returned, so a config we cannot edit safely is
//! reported instead of written.
use crate::integration_config::clean_jsonc;
use serde_json::Value;

pub const SERVER: &str = "cairngorm";

/// Byte offset of the value of a root-level `key`, in the cleaned text.
fn root_value(clean: &str, key: &str) -> Option<usize> {
    let bytes = clean.as_bytes();
    let (mut depth, mut i) = (0usize, 0usize);
    while i < bytes.len() {
        match bytes[i] {
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth = depth.saturating_sub(1),
            b'"' => {
                let start = i;
                i += 1;
                while i < bytes.len() && bytes[i] != b'"' {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
                let after = clean.get(i + 1..)?.trim_start();
                if depth == 1
                    && after.starts_with(':')
                    && serde_json::from_str::<String>(clean.get(start..=i)?)
                        .ok()
                        .as_deref()
                        == Some(key)
                {
                    let colon = clean.len() - after.len();
                    let value = clean[colon + 1..].trim_start();
                    return Some(clean.len() - value.len());
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Add `"cairngorm": entry` under the root object `parent`, creating it when absent.
/// An existing entry is left alone; callers decide whether it is ours.
pub fn add_json_server(text: &str, parent: &str, entry: &Value) -> Result<String, String> {
    if text.trim().is_empty() {
        let doc = serde_json::json!({ parent: { SERVER: entry } });
        return serde_json::to_string_pretty(&doc).map_err(|e| e.to_string());
    }
    let clean = clean_jsonc(text);
    let parsed: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let root = parsed.as_object().ok_or("config must be an object")?;
    let item = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    let updated = match root.get(parent) {
        Some(Value::Object(servers)) if servers.contains_key(SERVER) => return Ok(text.to_string()),
        Some(Value::Object(servers)) => {
            let at = root_value(&clean, parent).ok_or("server list not found")?;
            if clean.as_bytes().get(at) != Some(&b'{') {
                return Err(format!("{parent} could not be edited safely"));
            }
            let sep = if servers.is_empty() { "" } else { "," };
            format!(
                "{}\n    \"{SERVER}\": {item}{sep}{}",
                &text[..at + 1],
                &text[at + 1..]
            )
        }
        Some(_) => return Err(format!("{parent} must be an object")),
        None => {
            let open = clean.find('{').ok_or("missing config object")?;
            let sep = if root.is_empty() { "" } else { "," };
            format!(
                "{}\n  \"{parent}\": {{ \"{SERVER}\": {item} }}{sep}{}",
                &text[..open + 1],
                &text[open + 1..]
            )
        }
    };
    if json_server(&updated, parent).as_ref() != Some(entry) {
        return Err("the configuration could not be edited safely".into());
    }
    Ok(updated)
}

/// Add only missing discovery defaults to an owned server, keeping its options and comments.
pub fn add_json_defaults(text: &str, parent: &str, defaults: &Value) -> Result<String, String> {
    let clean = clean_jsonc(text);
    let mut expected: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let current = expected
        .get_mut(parent)
        .and_then(|v| v.get_mut(SERVER))
        .and_then(Value::as_object_mut)
        .ok_or("The MCP server must be an object")?;
    let missing: serde_json::Map<String, Value> = defaults
        .as_object()
        .ok_or("Defaults must be an object")?
        .iter()
        .filter(|(key, _)| !current.contains_key(*key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    if missing.is_empty() {
        return Ok(text.into());
    }
    let sep = if current.is_empty() { "" } else { "," };
    current.extend(missing.clone());
    let parent_at = root_value(&clean, parent).ok_or("Server list not found")?;
    let at = parent_at + root_value(&clean[parent_at..], SERVER).ok_or("Server entry not found")?;
    if clean.as_bytes().get(at) != Some(&b'{') {
        return Err("Server entry could not be edited safely".into());
    }
    let fields = serde_json::to_string(&missing).map_err(|e| e.to_string())?;
    let updated = format!(
        "{}\n    {}{sep}{}",
        &text[..at + 1],
        &fields[1..fields.len() - 1],
        &text[at + 1..]
    );
    let parsed: Value = serde_json::from_str(&clean_jsonc(&updated)).map_err(|e| e.to_string())?;
    if parsed != expected {
        return Err("The configuration could not be edited safely".into());
    }
    Ok(updated)
}

/// The registered entry, if any.
pub fn json_server(text: &str, parent: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(&clean_jsonc(text)).ok()?;
    value.get(parent)?.get(SERVER).cloned()
}

/// Codex's entry, however the user spelled the table (quoted keys, inline tables).
pub fn toml_server(text: &str) -> Result<Option<toml::Value>, String> {
    let value: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    Ok(value
        .get("mcp_servers")
        .and_then(|servers| servers.get(SERVER))
        .cloned())
}

/// Append Codex's table. JSON string escapes are valid TOML basic strings.
pub fn add_toml_server(text: &str, command: &str, bridge: &str) -> Result<String, String> {
    add_toml_args(text, command, &[bridge])
}

pub fn add_toml_args(text: &str, command: &str, args: &[&str]) -> Result<String, String> {
    if toml_server(text)?.is_some() {
        return Ok(text.to_string());
    }
    let quote = |s: &str| serde_json::to_string(s).unwrap_or_default();
    let mut out = text.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&format!(
        "\n[mcp_servers.{SERVER}]\ncommand = {}\nargs = {}\n",
        quote(command),
        serde_json::to_string(args).map_err(|e| e.to_string())?
    ));
    // An inline `mcp_servers = {…}` cannot take a new table; re-parsing catches that.
    let added = toml_server(&out).ok().flatten();
    let written = added.as_ref().and_then(|t| t.get("command")?.as_str());
    if written != Some(command) {
        return Err("config.toml could not be edited safely".into());
    }
    Ok(out)
}

/// Match the launched script, not a path fragment or an unrelated option.
pub fn runs_bridge(entry: &Value, bridge: &str) -> bool {
    let script = entry["args"]
        .as_array()
        .and_then(|args| args.first())
        .or_else(|| {
            entry["command"]
                .as_array()
                .and_then(|command| command.get(1))
        });
    script.and_then(Value::as_str) == Some(bridge)
}
