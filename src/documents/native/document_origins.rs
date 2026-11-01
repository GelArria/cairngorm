//! Two loopback origins per (provider, project): Cairngorm's frame on `d-<key>.localhost` and
//! the provider page on `v-<key>.localhost`, both on the gateway port.
//! Only origins handed to a pane are served, so guessing a key loads nothing.
use sha2::{Digest, Sha256};
use std::sync::{Mutex, OnceLock};

/// Bounded so a long session cannot grow it forever; the oldest origin is dropped first.
const MAX_ORIGINS: usize = 1024;

/// Host key -> provider id.
static ORIGINS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// Per-install random salt: keys cannot be predicted from provider and project ids, so other
/// local pages cannot address a provider's storage origin.
static SALT: OnceLock<String> = OnceLock::new();

pub fn set_salt(salt: String) {
    let _ = SALT.set(salt);
}

pub fn origin_key(provider: &str, scope: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(b"document\0");
    hash.update(
        SALT.get()
            .map(String::as_str)
            .unwrap_or_default()
            .as_bytes(),
    );
    hash.update([0]);
    hash.update(provider.as_bytes());
    hash.update([0]);
    hash.update(scope.as_bytes());
    format!("{:x}", hash.finalize())[..32].to_string()
}

/// Registers the pair and returns the frame (d-) origin a pane loads.
pub fn view_origin(gateway: &str, provider: &str, scope: &str) -> String {
    let port = gateway.rsplit(':').next().unwrap_or_default();
    let key = origin_key(provider, scope);
    let mut origins = ORIGINS.lock().unwrap_or_else(|e| e.into_inner());
    if !origins.iter().any(|(k, _)| k == &key) {
        if origins.len() >= MAX_ORIGINS {
            origins.remove(0);
        }
        origins.push((key.clone(), provider.to_string()));
    }
    format!("http://d-{key}.localhost:{port}")
}

/// Removal revokes every origin of the provider; updates keep them, so open panes keep loading.
pub fn forget_provider(provider: &str) {
    ORIGINS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|(_, id)| id != provider);
}

pub fn provider_for(key: &str) -> Option<String> {
    ORIGINS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, id)| id.clone())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Host {
    /// Cairngorm's relay frame.
    Frame,
    /// The provider's own files.
    Provider,
}

/// The role and key of a document host on this gateway's port; `None` for any other host.
pub fn host_key<'a>(gateway: &str, host: &'a str) -> Option<(Host, &'a str)> {
    let port = gateway.rsplit(':').next()?;
    let (role, rest) = if let Some(rest) = host.strip_prefix("d-") {
        (Host::Frame, rest)
    } else {
        (Host::Provider, host.strip_prefix("v-")?)
    };
    let key = rest.strip_suffix(&format!(".localhost:{port}"))?;
    (key.len() == 32
        && key
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
    .then_some((role, key))
}

pub fn is_document_origin(gateway: &str, origin: &str) -> bool {
    origin
        .trim_end_matches('/')
        .strip_prefix("http://")
        .is_some_and(|host| host_key(gateway, host).is_some())
}

/// Any `d-`/`v-` host, even malformed or for another port: never an MCP or view route.
pub fn is_document_host(host: &str) -> bool {
    (host.starts_with("d-") || host.starts_with("v-")) && host.contains(".localhost")
}

pub fn frame_origin(gateway: &str, key: &str) -> String {
    let port = gateway.rsplit(':').next().unwrap_or_default();
    format!("http://d-{key}.localhost:{port}")
}

pub fn provider_origin(gateway: &str, key: &str) -> String {
    let port = gateway.rsplit(':').next().unwrap_or_default();
    format!("http://v-{key}.localhost:{port}")
}
