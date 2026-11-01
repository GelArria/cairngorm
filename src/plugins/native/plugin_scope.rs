use super::{catalog::PluginSpec, upstream::Upstream};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

type TerminalUpstreams = HashMap<&'static str, Arc<Upstream>>;

#[derive(Default)]
pub struct Upstreams(Mutex<HashMap<String, TerminalUpstreams>>);

impl Upstreams {
    pub fn get(&self, plugin: &'static PluginSpec, terminal: &str) -> Arc<Upstream> {
        let mut terminals = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if terminals.len() >= 64 && !terminals.contains_key(terminal) {
            terminals.retain(|terminal, _| crate::pty::session_exists(terminal));
        }
        terminals
            .entry(terminal.to_string())
            .or_default()
            .entry(plugin.id)
            .or_insert_with(|| Arc::new(Upstream::new(plugin)))
            .clone()
    }

    pub fn reset(&self, plugin: &str) {
        let upstreams: Vec<_> = self
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .filter_map(|plugins| plugins.get(plugin).cloned())
            .collect();
        for upstream in upstreams {
            upstream.reset();
        }
    }
}

pub fn view_origin(gateway: &str, plugin: &str, terminal: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(plugin.as_bytes());
    hash.update([0]);
    hash.update(terminal.as_bytes());
    let key = format!("{:x}", hash.finalize());
    let port = gateway.rsplit(':').next().unwrap_or_default();
    format!("http://p-{}.localhost:{port}", &key[..32])
}

pub fn matches_view_host(gateway: &str, host: Option<&str>, plugin: &str, terminal: &str) -> bool {
    host == view_origin(gateway, plugin, terminal).strip_prefix("http://")
}

pub fn is_view_origin(gateway: &str, origin: &str) -> bool {
    let origin = origin.trim_end_matches('/');
    if origin == gateway {
        return true;
    }
    let port = gateway.rsplit(':').next().unwrap_or_default();
    origin
        .strip_prefix("http://p-")
        .and_then(|host| host.strip_suffix(&format!(".localhost:{port}")))
        .is_some_and(|key| {
            key.len() == 32
                && key
                    .bytes()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        })
}
