//! Provider credentials stay in the OS vault; configuration stores opaque references.
use serde_json::{Map, Value};

#[cfg(not(test))]
fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.cairngorm.agent", id)
        .map_err(|_| "Could not access the system credential store.".into())
}

#[cfg(not(test))]
fn put(id: &str, value: &str) -> Result<(), String> {
    entry(id)?.set_password(value).map_err(|_| {
        "Could not save the API key in the system credential store. Unlock it or use an environment variable.".into()
    })
}

#[cfg(not(test))]
fn get(id: &str) -> Result<String, String> {
    entry(id)?.get_password().map_err(|_| {
        "The saved API key is unavailable. Unlock the system credential store or enter the key again.".into()
    })
}

#[cfg(not(test))]
pub fn delete(id: &str) {
    // A stale reference is harmless; never fail a completed config save on cleanup.
    let _ = entry(id).and_then(|entry| entry.delete_credential().map_err(|_| String::new()));
}

#[cfg(test)]
fn vault() -> &'static std::sync::Mutex<std::collections::HashMap<String, String>> {
    static VAULT: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, String>>> =
        std::sync::OnceLock::new();
    VAULT.get_or_init(Default::default)
}
#[cfg(test)]
fn put(id: &str, value: &str) -> Result<(), String> {
    vault().lock().unwrap().insert(id.into(), value.into());
    Ok(())
}
#[cfg(test)]
fn get(id: &str) -> Result<String, String> {
    vault()
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or("Missing test credential".into())
}
#[cfg(test)]
pub fn delete(id: &str) {
    vault().lock().unwrap().remove(id);
}

pub fn read(cfg: &Map<String, Value>) -> Result<Option<String>, String> {
    match cfg.get("apiKeyRef").and_then(Value::as_str) {
        Some(id) => get(id).map(Some),
        None => Ok(cfg.get("apiKey").and_then(Value::as_str).map(String::from)),
    }
}

pub fn save(cfg: &mut Map<String, Value>, key: &str) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    put(&id, key)?;
    cfg.remove("apiKey");
    cfg.insert("apiKeyRef".into(), id.clone().into());
    Ok(id)
}
