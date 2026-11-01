use serde_json::Value;
use std::{fs, path::Path};

/// Blank JSONC comments/trailing commas without changing byte offsets.
pub(crate) fn clean_jsonc(text: &str) -> String {
    let mut bytes = text.as_bytes().to_vec();
    let mut i = 0;
    let mut string = false;
    while i < bytes.len() {
        if string {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'"' {
                string = false;
            }
        } else if bytes[i] == b'"' {
            string = true;
        } else if bytes.get(i..i + 2) == Some(b"//") {
            while i < bytes.len() && bytes[i] != b'\n' {
                bytes[i] = b' ';
                i += 1;
            }
            continue;
        } else if bytes.get(i..i + 2) == Some(b"/*") {
            bytes[i] = b' ';
            bytes[i + 1] = b' ';
            i += 2;
            while i + 1 < bytes.len() && &bytes[i..i + 2] != b"*/" {
                bytes[i] = b' ';
                i += 1;
            }
            if i + 1 < bytes.len() {
                bytes[i] = b' ';
                bytes[i + 1] = b' ';
                i += 2;
            }
            continue;
        }
        i += 1;
    }
    i = 0;
    string = false;
    while i < bytes.len() {
        if string {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'"' {
                string = false;
            }
        } else if bytes[i] == b'"' {
            string = true;
        } else if bytes[i] == b','
            && bytes[i + 1..]
                .iter()
                .find(|b| !b.is_ascii_whitespace())
                .is_some_and(|b| *b == b']' || *b == b'}')
        {
            bytes[i] = b' ';
        }
        i += 1;
    }
    String::from_utf8(bytes).unwrap_or_default()
}

pub fn add_plugin(text: &str, key: &str, plugin: &str) -> Result<String, String> {
    let clean = clean_jsonc(text);
    let parsed: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let root = parsed.as_object().ok_or("config must be an object")?;
    let item = serde_json::to_string(plugin).unwrap();
    if let Some(value) = root.get(key) {
        let array = value.as_array().ok_or("plugins must be an array")?;
        if array.iter().any(|v| v.as_str() == Some(plugin)) {
            return Ok(text.into());
        }
        // Locate only a ROOT key; nested settings named plugin are not registrations.
        let b = clean.as_bytes();
        let mut depth = 0;
        let mut i = 0;
        while i < b.len() {
            match b[i] {
                b'{' | b'[' => depth += 1,
                b'}' | b']' => depth -= 1,
                b'"' => {
                    let start = i;
                    i += 1;
                    while i < b.len() && b[i] != b'"' {
                        if b[i] == b'\\' {
                            i += 1;
                        }
                        i += 1;
                    }
                    if depth == 1
                        && clean[i + 1..].trim_start().starts_with(':')
                        && serde_json::from_str::<String>(&clean[start..=i])
                            .ok()
                            .as_deref()
                            == Some(key)
                    {
                        let start_array =
                            clean[i + 1..].find('[').ok_or("missing plugin array")? + i + 1;
                        // Plugin entries can be [spec, options]; walk their arrays/strings too.
                        let mut j = start_array + 1;
                        let mut level = 1;
                        let mut in_string = false;
                        while j < b.len() {
                            if in_string {
                                if b[j] == b'\\' {
                                    j += 2;
                                    continue;
                                }
                                if b[j] == b'"' {
                                    in_string = false;
                                }
                            } else {
                                match b[j] {
                                    b'"' => in_string = true,
                                    b'[' => level += 1,
                                    b']' => {
                                        level -= 1;
                                        if level == 0 {
                                            break;
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            j += 1;
                        }
                        // Insert before first item, so an existing trailing comma stays untouched.
                        let sep = if array.is_empty() { "" } else { "," };
                        return Ok(format!(
                            "{}{}{}{}",
                            &text[..start_array + 1],
                            item,
                            sep,
                            &text[start_array + 1..]
                        ));
                    }
                }
                _ => {}
            }
            i += 1;
        }
        Err("plugin registration not found".into())
    } else {
        let open = clean.find('{').ok_or("missing config object")?;
        let sep = if root.is_empty() { "" } else { "," };
        Ok(format!(
            "{}\n  \"{key}\": [{item}]{sep}{}",
            &text[..open + 1],
            &text[open + 1..]
        ))
    }
}

/// Removes `plugin` from the root `key` array, keeping the other entries and the file layout
/// (a comment between the removed item and its comma goes with it).
/// Returns the text unchanged when the plugin is not listed.
pub fn remove_plugin(text: &str, key: &str, plugin: &str) -> Result<String, String> {
    let clean = clean_jsonc(text);
    let parsed: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let mut expected = parsed.clone();
    let Some(list) = expected.get_mut(key).and_then(Value::as_array_mut) else {
        return Ok(text.into());
    };
    let before = list.len();
    list.retain(|item| item.as_str() != Some(plugin));
    if list.len() == before {
        return Ok(text.into());
    }
    let item = serde_json::to_string(plugin).map_err(|e| e.to_string())?;
    let b = clean.as_bytes();
    let skip = |mut i: usize| {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        i
    };
    // Try each spelling of the literal; the parse check proves which one was the list item.
    for (start, _) in clean.match_indices(&item) {
        let end = start + item.len();
        let after = skip(end);
        let updated = if b.get(after) == Some(&b',') {
            format!("{}{}", &text[..start], &text[skip(after + 1)..])
        } else {
            let mut comma = start;
            while comma > 0 && b[comma - 1].is_ascii_whitespace() {
                comma -= 1;
            }
            if comma > 0 && b[comma - 1] == b',' {
                format!("{}{}", &text[..comma - 1], &text[end..])
            } else {
                format!("{}{}", &text[..start], &text[end..])
            }
        };
        let check: Result<Value, _> = serde_json::from_str(&clean_jsonc(&updated));
        if check.as_ref().ok() == Some(&expected) {
            return Ok(updated);
        }
    }
    Err("The plugin list could not be edited safely; edit it by hand".into())
}

pub fn write_config(path: &Path, text: &str) -> Result<(), String> {
    write_config_with(path, text, true)
}

/// `backup: false` for files inside a project folder: a copy next to them would escape
/// the ignore rules that keep their credentials out of version control.
pub fn write_config_with(path: &Path, text: &str, backup: bool) -> Result<(), String> {
    if path.is_file() {
        if fs::read_to_string(path).map_err(|e| e.to_string())? == text {
            return Ok(());
        }
        // Preserve the original, including comments and credentials; never print it.
        let copy = path.with_extension("cairngorm-backup");
        if backup && !copy.exists() {
            fs::copy(path, &copy).map_err(|e| e.to_string())?;
            fs::set_permissions(
                &copy,
                fs::metadata(path).map_err(|e| e.to_string())?.permissions(),
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let tmp = path.with_extension("cairngorm-tmp");
    // Restrictive at creation, not only after write: settings may contain secrets.
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
    if let Ok(metadata) = fs::metadata(path) {
        fs::set_permissions(&tmp, metadata.permissions()).map_err(|e| e.to_string())?;
    }
    use std::io::Write;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "../../../tests/native/integration-config.rs"]
mod tests;
