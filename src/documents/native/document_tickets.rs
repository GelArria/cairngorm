//! Immutable open tickets: an agent's authorized snapshot handed to the main window. The pane
//! renders these exact bytes; it never re-reads the agent's pathname, so a file replaced after
//! authorization cannot reach the view. The tool answers only after the UI acknowledges.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

const MAX_TICKETS: usize = 32;
const MAX_TOTAL_BYTES: usize = 256 * 1024 * 1024;
pub const ACK_TIMEOUT: Duration = Duration::from_secs(20);

pub struct OpenRequest {
    pub project: String,
    pub terminal: String,
    pub path: String,
    pub bytes: Vec<u8>,
}

/// What the main window receives; the bytes stay native until a pane reads them.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenAnnouncement {
    pub ticket: String,
    pub project: String,
    pub terminal: String,
    pub path: String,
    pub name: String,
    pub size: usize,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Ack {
    /// Opened, with how it is shown ("document" or "editor") and what the pane offers agents.
    Opened(String, serde_json::Value),
    Failed(String),
}

#[derive(Default)]
struct State {
    tickets: VecDeque<(String, Arc<Vec<u8>>)>,
    acks: HashMap<String, Ack>,
}

#[derive(Default)]
pub struct Tickets {
    state: Mutex<State>,
    changed: Condvar,
}

impl Tickets {
    /// Stores the snapshot, announces it, and waits for the UI's acknowledgement.
    pub fn open(
        &self,
        request: OpenRequest,
        announce: impl FnOnce(&OpenAnnouncement) -> Result<(), String>,
        timeout: Duration,
    ) -> Result<(OpenAnnouncement, String, serde_json::Value), String> {
        let ticket = uuid::Uuid::new_v4().simple().to_string();
        let announcement = OpenAnnouncement {
            ticket: ticket.clone(),
            name: request
                .path
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or("document")
                .to_string(),
            size: request.bytes.len(),
            sha256: format!("{:x}", Sha256::digest(&request.bytes)),
            project: request.project,
            terminal: request.terminal,
            path: request.path,
        };
        self.insert(&ticket, request.bytes);
        if let Err(error) = announce(&announcement) {
            self.remove(&ticket);
            return Err(error);
        }
        let deadline = Instant::now() + timeout;
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(ack) = state.acks.remove(&ticket) {
                return match ack {
                    Ack::Opened(view, details) => Ok((announcement, view, details)),
                    Ack::Failed(error) => {
                        drop(state);
                        self.remove(&ticket);
                        Err(error)
                    }
                };
            }
            let now = Instant::now();
            if now >= deadline {
                drop(state);
                self.remove(&ticket);
                return Err("Cairngorm did not open the document in time.".into());
            }
            state = self
                .changed
                .wait_timeout(state, deadline - now)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    /// Only tickets still waiting or already opened can be acknowledged; late acks are ignored.
    pub fn acknowledge(&self, ticket: &str, ack: Ack) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.tickets.iter().any(|(id, _)| id == ticket) {
            return false;
        }
        state.acks.insert(ticket.to_string(), ack);
        self.changed.notify_all();
        true
    }

    pub fn read(&self, ticket: &str) -> Option<Arc<Vec<u8>>> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state
            .tickets
            .iter()
            .find(|(id, _)| id == ticket)
            .map(|(_, bytes)| bytes.clone())
    }

    fn insert(&self, ticket: &str, bytes: Vec<u8>) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state
            .tickets
            .push_back((ticket.to_string(), Arc::new(bytes)));
        // Oldest tickets go first; their panes fall back to the user's own file read.
        while state.tickets.len() > MAX_TICKETS
            || state.tickets.iter().map(|(_, b)| b.len()).sum::<usize>() > MAX_TOTAL_BYTES
        {
            let Some((evicted, _)) = state.tickets.pop_front() else {
                break;
            };
            state.acks.remove(&evicted);
        }
    }

    fn remove(&self, ticket: &str) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.tickets.retain(|(id, _)| id != ticket);
        state.acks.remove(ticket);
    }
}

#[cfg(test)]
#[path = "../../../tests/native/document_tickets.rs"]
mod tests;
