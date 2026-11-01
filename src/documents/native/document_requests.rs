//! Requests the agent gateway sends to the main window and waits for (document operations).
//! Each answer is accepted once; answers after the deadline find nothing to complete.
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};

const MAX_PENDING: usize = 16;

#[derive(Default)]
pub struct Requests {
    pending: Mutex<HashMap<String, Option<Result<Value, String>>>>,
    changed: Condvar,
}

impl Requests {
    pub fn run(
        &self,
        announce: impl FnOnce(&str) -> Result<(), String>,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = uuid::Uuid::new_v4().simple().to_string();
        {
            let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            if pending.len() >= MAX_PENDING {
                return Err("Too many document requests are waiting. Try again shortly.".into());
            }
            pending.insert(id.clone(), None);
        }
        if let Err(error) = announce(&id) {
            self.forget(&id);
            return Err(error);
        }
        let deadline = Instant::now() + timeout;
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(Some(_)) = pending.get(&id) {
                return pending
                    .remove(&id)
                    .flatten()
                    .unwrap_or_else(|| Err("Lost answer.".into()));
            }
            let now = Instant::now();
            if now >= deadline {
                pending.remove(&id);
                return Err("Cairngorm did not finish the document request in time.".into());
            }
            pending = self
                .changed
                .wait_timeout(pending, deadline - now)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    pub fn complete(&self, id: &str, outcome: Result<Value, String>) -> bool {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        match pending.get_mut(id) {
            Some(slot @ None) => {
                *slot = Some(outcome);
                self.changed.notify_all();
                true
            }
            _ => false,
        }
    }

    fn forget(&self, id: &str) {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    }
}

#[cfg(test)]
#[path = "../../../tests/native/document_requests.rs"]
mod tests;
