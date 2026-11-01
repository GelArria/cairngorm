//! Cancellation of an agent's in-flight request. A request is cancelled when its client sends
//! `notifications/cancelled`, or when the client's connection closes (the agent went away).
//! Long work (application scripts and calls) checks `current()` while it waits.
use serde_json::Value;
use std::{
    cell::RefCell,
    collections::HashMap,
    io::ErrorKind,
    net::TcpStream,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

type Key = (String, String);
static REQUESTS: Mutex<Option<HashMap<Key, Arc<AtomicBool>>>> = Mutex::new(None);

thread_local! {
    static CURRENT: RefCell<Option<Token>> = const { RefCell::new(None) };
}

/// Request ids are only unique per client, so the bridge process id is part of the key.
fn key(client: Option<&str>, id: &Value) -> Key {
    (client.unwrap_or_default().to_string(), id.to_string())
}

#[derive(Clone)]
pub struct Token {
    flag: Arc<AtomicBool>,
    connection: Option<Arc<TcpStream>>,
    checked: Arc<Mutex<Instant>>,
}

impl Token {
    pub fn new(flag: Arc<AtomicBool>, connection: Option<TcpStream>) -> Self {
        Self {
            flag,
            connection: connection.map(Arc::new),
            checked: Arc::new(Mutex::new(Instant::now())),
        }
    }

    /// Explicitly cancelled, or (checked at most once a second) the client hung up.
    pub fn cancelled(&self) -> bool {
        if self.flag.load(Ordering::SeqCst) {
            return true;
        }
        let Some(connection) = &self.connection else {
            return false;
        };
        let mut checked = self.checked.lock().unwrap_or_else(|e| e.into_inner());
        if checked.elapsed() < Duration::from_secs(1) {
            return false;
        }
        *checked = Instant::now();
        if hung_up(connection) {
            self.flag.store(true, Ordering::SeqCst);
        }
        self.flag.load(Ordering::SeqCst)
    }
}

/// A peer that closed its end reads as end-of-stream; a quiet open one would block.
fn hung_up(connection: &TcpStream) -> bool {
    if connection.set_nonblocking(true).is_err() {
        return false;
    }
    let mut byte = [0u8; 1];
    let closed = match connection.peek(&mut byte) {
        Ok(0) => true,
        Ok(_) => false,
        Err(error) => !matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted),
    };
    let _ = connection.set_nonblocking(false);
    closed
}

/// Registers the request handled on this thread until the guard is dropped.
pub struct Guard(Option<(Key, Arc<AtomicBool>)>);

pub fn begin(client: Option<&str>, id: &Value, connection: Option<TcpStream>) -> Guard {
    let flag = Arc::new(AtomicBool::new(false));
    // Without a client identity ids could collide; such a request still ends on hang-up.
    let key = (!id.is_null() && client.is_some_and(|c| !c.is_empty())).then(|| key(client, id));
    if let Some(key) = &key {
        REQUESTS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert_with(HashMap::new)
            .insert(key.clone(), flag.clone());
    }
    CURRENT.with(|current| *current.borrow_mut() = Some(Token::new(flag.clone(), connection)));
    Guard(key.map(|key| (key, flag)))
}

impl Drop for Guard {
    /// Removes only its own registration, never a newer request that reused the key.
    fn drop(&mut self) {
        CURRENT.with(|current| current.borrow_mut().take());
        if let Some((key, flag)) = self.0.take() {
            if let Some(requests) = REQUESTS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                if requests
                    .get(&key)
                    .is_some_and(|mine| Arc::ptr_eq(mine, &flag))
                {
                    requests.remove(&key);
                }
            }
        }
    }
}

/// `notifications/cancelled` from a client: its request with that id stops.
pub fn cancel(client: Option<&str>, request_id: &Value) {
    if let Some(flag) = REQUESTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|requests| requests.get(&key(client, request_id)))
    {
        flag.store(true, Ordering::SeqCst);
    }
}

/// The request handled on this thread, if any.
pub fn current() -> Option<Token> {
    CURRENT.with(|current| current.borrow().clone())
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_cancel.rs"]
mod tests;
