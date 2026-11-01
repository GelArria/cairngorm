//! Plugin sign-ins in the OS credential store. Windows keeps a credential as UTF-16 in at
//! most 2560 bytes, so 1280 characters, which a token set can exceed. A value is therefore
//! split across numbered entries: `<id>` holds the part count, `<id>#<n>` the parts.

/// Characters per part, well under the Windows limit.
const PART: usize = 1000;
/// Above any realistic token set; a corrupt count must not read forever.
const MAX_PARTS: usize = 64;

fn part_key(id: &str, index: usize) -> String {
    format!("{id}#{index}")
}

fn count(id: &str) -> Result<Option<usize>, String> {
    let header = store::get(id)?;
    Ok(header
        .as_deref()
        .and_then(|h| h.strip_prefix("parts:"))
        .and_then(|n| n.parse().ok())
        .filter(|n| *n <= MAX_PARTS))
}

/// `Ok(None)` when nothing (or nothing whole) is stored; `Err` when the store is unavailable.
pub fn get(id: &str) -> Result<Option<String>, String> {
    let Some(parts) = count(id)? else {
        return Ok(None);
    };
    let mut value = String::new();
    for index in 0..parts {
        match store::get(&part_key(id, index))? {
            Some(part) => value.push_str(&part),
            None => return Ok(None),
        }
    }
    Ok(Some(value))
}

/// Parts first, then the count: a reader never sees a count whose parts are missing.
pub fn put(id: &str, value: &str) -> Result<(), String> {
    let chars: Vec<char> = value.chars().collect();
    let parts: Vec<String> = chars.chunks(PART).map(|c| c.iter().collect()).collect();
    let previous = count(id).ok().flatten().unwrap_or(0);
    for (index, part) in parts.iter().enumerate() {
        store::put(&part_key(id, index), part)?;
    }
    store::put(id, &format!("parts:{}", parts.len()))?;
    for index in parts.len()..previous {
        store::delete(&part_key(id, index));
    }
    Ok(())
}

pub fn delete(id: &str) {
    // An unreadable count may still hide parts; sweep them all rather than leave any.
    let parts = match count(id) {
        Ok(parts) => parts.unwrap_or(0),
        Err(_) => MAX_PARTS,
    };
    store::delete(id);
    for index in 0..parts {
        store::delete(&part_key(id, index));
    }
}

#[cfg(not(test))]
mod store {
    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new("com.cairngorm.plugins", key)
            .map_err(|_| "Could not access the system credential store.".to_string())
    }
    /// `Ok(None)`: nothing stored. `Err`: the store is unavailable (locked, no service).
    pub fn get(key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("The system credential store is unavailable: {e}")),
        }
    }
    pub fn put(key: &str, value: &str) -> Result<(), String> {
        entry(key)?
            .set_password(value)
            .map_err(|e| format!("Could not save the sign-in in the system credential store: {e}"))
    }
    pub fn delete(key: &str) {
        // Nothing stored is the goal; a missing entry is already that.
        let _ = entry(key).map(|entry| entry.delete_credential());
    }
}

/// In memory, with the Windows size limit, so tests catch values that would not fit.
#[cfg(test)]
pub mod store {
    use std::{collections::HashMap, sync::Mutex};
    static STORE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
    pub fn get(key: &str) -> Result<Option<String>, String> {
        Ok(STORE
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|m| m.get(key).cloned()))
    }
    pub fn put(key: &str, value: &str) -> Result<(), String> {
        if value.encode_utf16().count() * 2 > 2560 {
            return Err(format!("{key}: credential too large for Windows"));
        }
        let mut store = STORE.lock().unwrap();
        store
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), value.into());
        Ok(())
    }
    pub fn delete(key: &str) {
        if let Some(store) = STORE.lock().unwrap().as_mut() {
            store.remove(key);
        }
    }
}
