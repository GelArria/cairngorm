//! Format-preserving edits of one MCP server entry, for any server name. Every edit is
//! checked by re-parsing: the result must equal the original with exactly that change.
use crate::integration_config::clean_jsonc;
use serde_json::Value;

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while i < b.len() && b[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// Index after the string that starts at `i`.
fn skip_string(b: &[u8], mut i: usize) -> usize {
    i += 1;
    while i < b.len() && b[i] != b'"' {
        i += if b[i] == b'\\' { 2 } else { 1 };
    }
    i + 1
}

/// Index after the value that starts at `i`.
fn skip_value(b: &[u8], i: usize) -> usize {
    match b.get(i) {
        Some(b'"') => skip_string(b, i),
        Some(b'{') | Some(b'[') => {
            let mut depth = 0usize;
            let mut j = i;
            while j < b.len() {
                match b[j] {
                    b'"' => {
                        j = skip_string(b, j);
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return j + 1;
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            j
        }
        _ => {
            let mut j = i;
            while j < b.len() && !matches!(b[j], b',' | b'}' | b']') && !b[j].is_ascii_whitespace()
            {
                j += 1;
            }
            j
        }
    }
}

/// (key start, value start, value end) of `key` in the object opening at `obj`.
fn member(clean: &str, obj: usize, key: &str) -> Option<(usize, usize, usize)> {
    let b = clean.as_bytes();
    if b.get(obj) != Some(&b'{') {
        return None;
    }
    let mut i = obj + 1;
    loop {
        i = skip_ws(b, i);
        if b.get(i) != Some(&b'"') {
            return None;
        }
        let key_start = i;
        let key_end = skip_string(b, i);
        let name: String = serde_json::from_str(clean.get(key_start..key_end)?).ok()?;
        i = skip_ws(b, key_end);
        if b.get(i) != Some(&b':') {
            return None;
        }
        let value_start = skip_ws(b, i + 1);
        let value_end = skip_value(b, value_start);
        if name == key {
            return Some((key_start, value_start, value_end));
        }
        i = skip_ws(b, value_end);
        if b.get(i) == Some(&b',') {
            i += 1;
        }
    }
}

/// Offset of the object reached by following `path` from the root.
fn object_at(clean: &str, path: &[&str]) -> Option<usize> {
    let mut at = skip_ws(clean.as_bytes(), 0);
    for key in path {
        at = member(clean, at, key)?.1;
    }
    Some(at)
}

fn without(mut value: Value, path: &[&str], name: &str) -> Option<Value> {
    let mut node = &mut value;
    for key in path {
        node = node.get_mut(*key)?;
    }
    node.as_object_mut()?.remove(name)?;
    Some(value)
}

/// Remove `name` from the object at `path`, keeping every other byte as written.
pub fn remove_json(text: &str, path: &[&str], name: &str) -> Result<String, String> {
    let clean = clean_jsonc(text);
    let original: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let expected = without(original, path, name).ok_or("Server not found in this config")?;
    let obj = object_at(&clean, path).ok_or("Server list not found")?;
    let (key_start, _, value_end) = member(&clean, obj, name).ok_or("Server not found")?;
    let b = clean.as_bytes();
    // Walk back over real whitespace only, so a comment beside the previous entry stays.
    let raw = text.as_bytes();
    let mut start = key_start;
    while start > 0 && raw[start - 1].is_ascii_whitespace() {
        start -= 1;
    }
    let after = skip_ws(b, value_end);
    let updated = if b.get(after) == Some(&b',') {
        format!("{}{}", &text[..start], &text[after + 1..])
    } else {
        // The last entry: drop the comma before it, looking through blanked comments.
        let mut c = key_start;
        while c > 0 && b[c - 1].is_ascii_whitespace() {
            c -= 1;
        }
        if c > 0 && b[c - 1] == b',' {
            let comma = c - 1;
            format!(
                "{}{}{}",
                &text[..comma],
                &text[comma + 1..start],
                &text[value_end..]
            )
        } else {
            format!("{}{}", &text[..start], &text[value_end..])
        }
    };
    let parsed: Value = serde_json::from_str(&clean_jsonc(&updated)).map_err(|e| e.to_string())?;
    if parsed != expected {
        return Err("The configuration could not be edited safely".into());
    }
    Ok(updated)
}

/// Add `name: entry` to the root object `parent` (created when absent).
pub fn add_json(text: &str, parent: &str, name: &str, entry: &Value) -> Result<String, String> {
    if text.trim().is_empty() {
        let doc = serde_json::json!({ parent: { name: entry } });
        return serde_json::to_string_pretty(&doc).map_err(|e| e.to_string());
    }
    let clean = clean_jsonc(text);
    let mut expected: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let root = expected.as_object_mut().ok_or("config must be an object")?;
    let key = serde_json::to_string(name).map_err(|e| e.to_string())?;
    let item = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    let updated = match root.get_mut(parent) {
        Some(Value::Object(servers)) => {
            if servers.contains_key(name) {
                return Err(format!("A server named \"{name}\" already exists"));
            }
            let sep = if servers.is_empty() { "" } else { "," };
            servers.insert(name.into(), entry.clone());
            let at = object_at(&clean, &[parent]).ok_or("server list not found")?;
            format!(
                "{}\n    {key}: {item}{sep}{}",
                &text[..at + 1],
                &text[at + 1..]
            )
        }
        Some(_) => return Err(format!("{parent} must be an object")),
        None => {
            let sep = if root.is_empty() { "" } else { "," };
            root.insert(parent.into(), serde_json::json!({ name: entry }));
            let open = object_at(&clean, &[]).ok_or("missing config object")?;
            let parent_key = serde_json::to_string(parent).map_err(|e| e.to_string())?;
            format!(
                "{}\n  {parent_key}: {{ {key}: {item} }}{sep}{}",
                &text[..open + 1],
                &text[open + 1..]
            )
        }
    };
    let parsed: Value = serde_json::from_str(&clean_jsonc(&updated)).map_err(|e| e.to_string())?;
    if parsed != expected {
        return Err("The configuration could not be edited safely".into());
    }
    Ok(updated)
}

/// Whether a TOML header line opens `[mcp_servers.<name>]` or one of its sub-tables.
fn opens_server(line: &str, name: &str) -> Option<bool> {
    let header = line.trim().strip_prefix('[')?.split(']').next()?;
    let mut parts = header.split('.').map(|p| p.trim().trim_matches('"'));
    Some(parts.next() == Some("mcp_servers") && parts.next() == Some(name))
}

fn toml_without(text: &str, name: &str) -> Result<toml::Value, String> {
    let mut value: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    value
        .get_mut("mcp_servers")
        .and_then(|s| s.as_table_mut())
        .and_then(|s| s.remove(name))
        .ok_or("Server not found in this config")?;
    Ok(value)
}

/// Remove Codex's `[mcp_servers.<name>]` tables. Inline spellings are refused.
pub fn remove_toml(text: &str, name: &str) -> Result<String, String> {
    let expected = toml_without(text, name)?;
    let mut out = String::with_capacity(text.len());
    let mut skipping = false;
    // Comments and blank lines at the end of a removed table usually introduce the next
    // one; they are held back and kept when a table we keep follows them.
    let mut held = String::new();
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if let Some(ours) = opens_server(line, name) {
            if !ours {
                out.push_str(&held);
            }
            held.clear();
            skipping = ours;
        } else if trimmed.starts_with('[') {
            out.push_str(&held);
            held.clear();
            skipping = false;
        } else if skipping {
            if trimmed.is_empty() || trimmed.starts_with('#') {
                held.push_str(line);
            } else {
                held.clear();
            }
            continue;
        }
        if !skipping {
            out.push_str(line);
        }
    }
    let mut parsed: toml::Value = toml::from_str(&out).map_err(|e| e.to_string())?;
    // Removing the last implicit child table also removes its empty parent in TOML.
    if parsed.get("mcp_servers").is_none()
        && expected
            .get("mcp_servers")
            .and_then(toml::Value::as_table)
            .is_some_and(|t| t.is_empty())
    {
        if let Some(table) = parsed.as_table_mut() {
            table.insert("mcp_servers".into(), toml::Value::Table(Default::default()));
        }
    }
    if parsed != expected {
        return Err("config.toml could not be edited safely; edit it by hand".into());
    }
    Ok(out)
}

/// Append `[mcp_servers.<name>]` with string or string-array fields.
pub fn add_toml(text: &str, name: &str, fields: &[(&str, Value)]) -> Result<String, String> {
    let current: toml::Value = toml::from_str(text).map_err(|e| e.to_string())?;
    if current
        .get("mcp_servers")
        .and_then(|s| s.get(name))
        .is_some()
    {
        return Err(format!("A server named \"{name}\" already exists"));
    }
    let mut out = text.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    // JSON strings and arrays of strings are valid TOML basic values.
    out.push_str(&format!(
        "\n[mcp_servers.{}]\n",
        serde_json::to_string(name).unwrap()
    ));
    for (key, value) in fields {
        out.push_str(&format!("{key} = {value}\n"));
    }
    let added: toml::Value = toml::from_str(&out).map_err(|e| e.to_string())?;
    if added.get("mcp_servers").and_then(|s| s.get(name)).is_none() {
        return Err("config.toml could not be edited safely".into());
    }
    Ok(out)
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_mcp_edit.rs"]
mod tests;
