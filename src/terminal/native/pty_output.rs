// One pending main-thread callback per terminal. Bursts coalesce without a
// timer; a slow webview backpressures only its reader instead of growing RAM.
use base64::Engine;
use std::sync::{Condvar, Mutex};

pub const OUTPUT_CAP: usize = 64 * 1024;

#[derive(Default)]
struct Pending {
    data: String,
    tail: Vec<u8>,
    len: usize,
    scheduled: bool,
    stopped: bool,
}

#[derive(Default)]
pub struct PtyOutput {
    pending: Mutex<Pending>,
    available: Condvar,
}

impl PtyOutput {
    /// Some(true) asks the producer to schedule a drain; None means shutdown.
    /// Only the background PTY reader may call this blocking method.
    pub fn push(&self, mut bytes: &[u8]) -> Option<bool> {
        assert!(bytes.len() <= OUTPUT_CAP);
        if bytes.is_empty() {
            return Some(false);
        }
        let mut pending = self.pending.lock().unwrap();
        while !pending.stopped && pending.len + bytes.len() > OUTPUT_CAP {
            pending = self.available.wait(pending).unwrap();
        }
        if pending.stopped {
            return None;
        }
        pending.len += bytes.len();
        // Encode on the reader, not the UI thread. Only complete triples may
        // concatenate as base64; retain at most two raw bytes until the drain.
        let Pending { data, tail, .. } = &mut *pending;
        if !tail.is_empty() {
            let take = (3 - tail.len()).min(bytes.len());
            tail.extend_from_slice(&bytes[..take]);
            bytes = &bytes[take..];
            if tail.len() == 3 {
                base64::engine::general_purpose::STANDARD.encode_string(&tail, data);
                tail.clear();
            }
        }
        let complete = bytes.len() / 3 * 3;
        base64::engine::general_purpose::STANDARD.encode_string(&bytes[..complete], data);
        tail.extend_from_slice(&bytes[complete..]);
        let schedule = !pending.scheduled;
        pending.scheduled = true;
        Some(schedule)
    }

    pub fn take(&self) -> String {
        let mut pending = self.pending.lock().unwrap();
        let mut data = std::mem::take(&mut pending.data);
        base64::engine::general_purpose::STANDARD.encode_string(&pending.tail, &mut data);
        pending.tail.clear();
        pending.len = 0;
        pending.scheduled = false;
        drop(pending);
        self.available.notify_one();
        data
    }

    /// Wake a reader blocked by a full queue; keep already accepted output.
    pub fn stop(&self) {
        self.pending.lock().unwrap().stopped = true;
        self.available.notify_all();
    }
}

#[cfg(test)]
#[path = "../../../tests/native/pty-output.rs"]
mod tests;
