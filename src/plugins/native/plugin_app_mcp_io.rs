//! The pipes of an application's MCP server: a writer thread that owns stdin, a reader thread
//! that routes replies, and why a request failed.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::ChildStdin,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

/// Why a request to the application's server failed, with a code the agent can act on.
#[derive(Debug, Clone, PartialEq)]
pub enum Failure {
    Stopped,
    TimedOut(Duration),
    Cancelled,
    /// It could not be started.
    Unavailable(String),
    /// The server's own error message.
    Server(String),
}

impl Failure {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Stopped => "app-stopped",
            Self::TimedOut(_) => "timed-out",
            Self::Cancelled => "cancelled",
            Self::Unavailable(_) => "app-unavailable",
            Self::Server(_) => "app-failed",
        }
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Stopped => write!(f, "The application's MCP server has stopped; the next request starts it again."),
            Self::TimedOut(limit) => write!(f, "The application did not answer within {} s; the next request starts its server again (retry with a larger timeoutSeconds if the work is long).", limit.as_secs()),
            Self::Cancelled => write!(f, "The request was cancelled."),
            Self::Unavailable(message) | Self::Server(message) => write!(f, "{message}"),
        }
    }
}
const MAX_LINE: u64 = 16 * 1024 * 1024;
pub type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

/// Writes queued messages; a failed write ends the session.
pub fn write(mut stdin: ChildStdin, outbox: mpsc::Receiver<Value>, dead: Arc<AtomicBool>) {
    for message in outbox {
        if writeln!(stdin, "{message}")
            .and_then(|()| stdin.flush())
            .is_err()
        {
            break;
        }
    }
    dead.store(true, Ordering::SeqCst);
}

/// Routes replies to their waiting request and answers the server's own requests (`ping`;
/// nothing else is offered). At EOF, an oversized line or unreadable output the session is
/// dead and every waiting request fails at once.
pub fn read(
    stdout: impl Read,
    outbox: mpsc::Sender<Value>,
    pending: Pending,
    dead: Arc<AtomicBool>,
) {
    let mut lines = BufReader::new(stdout);
    let mut line = String::new();
    loop {
        line.clear();
        match (&mut lines).take(MAX_LINE).read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if !line.ends_with('\n') && line.len() as u64 >= MAX_LINE => break,
            Ok(_) => {}
        }
        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        match (message["id"].as_u64(), message.get("method")) {
            (Some(id), None) => {
                let waiting = pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                if let Some(waiting) = waiting {
                    let _ = waiting.send(message);
                }
            }
            (_, Some(method)) if !message["id"].is_null() => {
                let _ = outbox.send(if method == "ping" {
                    json!({"jsonrpc": "2.0", "id": message["id"], "result": {}})
                } else {
                    json!({"jsonrpc": "2.0", "id": message["id"],
                        "error": {"code": -32601, "message": "Not supported by Cairngorm"}})
                });
            }
            _ => {}
        }
    }
    dead.store(true, Ordering::SeqCst);
    pending.lock().unwrap_or_else(|e| e.into_inner()).clear();
}
