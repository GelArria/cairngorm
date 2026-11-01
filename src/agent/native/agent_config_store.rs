use super::credentials;
use serde_json::{Map, Value};
use std::{fs, io::Write, path::PathBuf};

pub fn path() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".panel/agent/config.json")
}

pub fn read() -> Result<Map<String, Value>, String> {
    let raw = match fs::read_to_string(path()) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(_) => return Err("Could not read the agent configuration.".into()),
    };
    let mut cfg = serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}'))
        .ok()
        .and_then(|value| value.as_object().cloned())
        .ok_or("Agent configuration is invalid JSON. Repair it before saving.")?;
    // Migrate without making a plaintext backup. Keep the original intact if
    // the vault is unavailable; never silently discard a user's credential.
    if let Some(key) = cfg
        .get("apiKey")
        .and_then(Value::as_str)
        .filter(|k| !k.is_empty())
        .map(String::from)
    {
        let id = credentials::save(&mut cfg, &key)?;
        if let Err(error) = write(&cfg) {
            credentials::delete(&id);
            return Err(error);
        }
    }
    Ok(cfg)
}

pub fn write(cfg: &Map<String, Value>) -> Result<(), String> {
    let path = path();
    fs::create_dir_all(path.parent().ok_or("Missing config directory")?)
        .map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
        let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
        file.write_all(format!("{text}\n").as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        // std::fs::rename replaces an existing destination on Windows too.
        fs::rename(&tmp, &path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}
