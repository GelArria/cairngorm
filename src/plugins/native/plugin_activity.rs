//! Connection proof comes from a real bridge handshake and subsequent tools/list, not config writes.
use super::callers::Caller;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Instant,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientActivity {
    pub id: String,
    pub name: String,
    pub registration: Option<String>,
    pub agent: Option<&'static str>,
    pub last_seen: u64,
    pub synced: bool,
}

struct Contact {
    name: String,
    registration: Option<String>,
    agent: Option<&'static str>,
    terminal: String,
    pid: u32,
    started: Option<u64>,
    at: Instant,
    listed_revision: Option<String>,
}

fn memory() -> std::sync::MutexGuard<'static, HashMap<String, Contact>> {
    static MEMORY: OnceLock<Mutex<HashMap<String, Contact>>> = OnceLock::new();
    MEMORY
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

pub fn record(
    caller: &Caller,
    pid: Option<&str>,
    registration: Option<&str>,
    message: &Value,
    result: &Value,
    revision: &str,
) {
    let (Some(terminal), Some(pid)) = (&caller.terminal, pid.and_then(|p| p.parse::<u32>().ok()))
    else {
        return;
    };
    if result.get("error").is_some() {
        return;
    }
    let key = format!("{terminal}:{pid}");
    let mut contacts = memory();
    if message["method"] == "initialize" {
        if contacts.len() >= 1024 && !contacts.contains_key(&key) {
            if let Some(oldest) = contacts
                .iter()
                .min_by_key(|(_, c)| c.at)
                .map(|(key, _)| key.clone())
            {
                contacts.remove(&oldest);
            }
        }
        let Some(name) = message["params"]["clientInfo"]["name"].as_str() else {
            return;
        };
        let name: String = name.chars().filter(|c| !c.is_control()).take(80).collect();
        if name.trim().is_empty() {
            return;
        }
        contacts.insert(
            key.clone(),
            Contact {
                name,
                registration: registration
                    .filter(|id| uuid::Uuid::parse_str(id).is_ok())
                    .map(String::from),
                agent: caller.agent,
                terminal: terminal.clone(),
                pid,
                started: process_started(pid),
                at: Instant::now(),
                listed_revision: None,
            },
        );
    } else if let Some(contact) = contacts.get_mut(&key) {
        if message["method"] == "tools/list" && result["tools"].is_array() {
            contact.listed_revision = Some(revision.into());
        }
        contact.at = Instant::now();
    }
}

fn process_started(pid: u32) -> Option<u64> {
    let mut system = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(pid);
    system.refresh_process_specifics(pid, sysinfo::ProcessRefreshKind::new());
    system.process(pid).map(|process| process.start_time())
}

pub fn snapshot(revision: &str) -> Vec<ClientActivity> {
    snapshot_with(revision, |terminal, pid, started| {
        crate::pty::session_exists(terminal) && started.is_some() && process_started(pid) == started
    })
}

pub(super) fn snapshot_with(
    revision: &str,
    mut live: impl FnMut(&str, u32, Option<u64>) -> bool,
) -> Vec<ClientActivity> {
    memory()
        .iter()
        .filter(|(_, c)| c.listed_revision.is_some() && live(&c.terminal, c.pid, c.started))
        .map(|(key, c)| ClientActivity {
            id: key.clone(),
            name: c.name.clone(),
            registration: c.registration.clone(),
            agent: c.agent,
            last_seen: c.at.elapsed().as_secs(),
            synced: c.listed_revision.as_deref() == Some(revision),
        })
        .collect()
}
