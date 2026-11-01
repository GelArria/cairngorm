//! One application MCP server per terminal and application, started on first use and ended
//! with the terminal, Cairngorm, or the server. The registry lock is never held while calling
//! into other subsystems, starting a server, or ending one.
use super::{app_mcp::McpServer, app_mcp_io::Failure, app_mcp_session::Session};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

type Sessions = HashMap<(String, String), Arc<Session>>;
static SESSIONS: Mutex<Option<Sessions>> = Mutex::new(None);

/// Removes the sessions `keep` rejects; they are ended after the lock is released.
fn prune(keep: impl Fn(&(String, String), &Session) -> bool) {
    let ended: Vec<Arc<Session>> = {
        let mut guard = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        let sessions = guard.get_or_insert_with(HashMap::new);
        let gone: Vec<_> = sessions
            .iter()
            .filter(|(key, session)| !keep(key, session))
            .map(|(key, _)| key.clone())
            .collect();
        gone.iter().filter_map(|key| sessions.remove(key)).collect()
    };
    drop(ended);
}

/// The terminal's live session with this application, starting one when needed.
pub fn session(
    terminal: &str,
    app: &str,
    server: &McpServer,
    cwd: &Path,
) -> Result<Arc<Session>, Failure> {
    let terminals: Vec<String> = SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .flat_map(|sessions| sessions.keys().map(|(terminal, _)| terminal.clone()))
        .collect();
    let closed: Vec<String> = terminals
        .into_iter()
        .filter(|terminal| !crate::pty::session_exists(terminal))
        .collect();
    let key = (terminal.to_string(), app.to_string());
    prune(|(terminal, _), session| session.alive() && !closed.contains(terminal));
    let existing = SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|sessions| sessions.get(&key).cloned());
    if let Some(session) = existing.filter(|s| s.serves(server)) {
        return Ok(session);
    }
    // Started without the lock held: a slow server never blocks other applications.
    let started = Arc::new(Session::start(server, cwd)?);
    let replaced = {
        let mut guard = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        let sessions = guard.get_or_insert_with(HashMap::new);
        match sessions.get(&key) {
            Some(other) if other.alive() && other.serves(server) => return Ok(other.clone()),
            _ => sessions.insert(key, started.clone()),
        }
    };
    drop(replaced);
    Ok(started)
}

/// The terminal closed: its application servers end.
pub fn end_terminal(terminal: &str) {
    prune(|(owner, _), _| owner != terminal);
}

/// Every application server ends with Cairngorm. Never waits for the lock: this also runs
/// from the panic hook and the watchdog, where the lock may be held on this thread.
pub fn end_all() {
    let taken = match SESSIONS.try_lock() {
        Ok(mut guard) => guard.take(),
        Err(std::sync::TryLockError::Poisoned(error)) => error.into_inner().take(),
        Err(std::sync::TryLockError::WouldBlock) => None,
    };
    drop(taken);
}
