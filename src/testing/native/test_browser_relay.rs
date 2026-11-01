use super::BrowserEvent;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tauri::Emitter;

#[derive(Default)]
pub struct Relay {
    queue: Mutex<Queue>,
}
#[derive(Default)]
struct Queue {
    scheduled: bool,
    events: VecDeque<BrowserEvent>,
}

impl Queue {
    fn push(&mut self, event: BrowserEvent) {
        // Keep the latest screen per page, followed by its close event. A busy or
        // hung main window must never accumulate an unbounded video backlog.
        if event.kind == "frame" {
            if self
                .events
                .iter()
                .any(|e| e.page_id == event.page_id && e.kind == "closed")
            {
                return;
            }
            self.events
                .retain(|e| e.page_id != event.page_id || e.kind != "frame");
        }
        self.events.push_back(event);
        while self.events.len() > 24 {
            self.events.pop_front();
        }
    }
}

impl Relay {
    pub fn publish(self: &Arc<Self>, app: &tauri::AppHandle, id: &str, event: BrowserEvent) {
        {
            let mut queue = self.queue.lock().unwrap();
            queue.push(event);
            if queue.scheduled {
                return;
            }
            queue.scheduled = true;
        }
        let relay = self.clone();
        let app_handle = app.clone();
        let name = format!("test-browser-{id}");
        if app
            .run_on_main_thread(move || {
                let events = {
                    let mut queue = relay.queue.lock().unwrap();
                    queue.scheduled = false;
                    std::mem::take(&mut queue.events)
                };
                for event in events {
                    let _ = app_handle.emit(&name, event);
                }
            })
            .is_err()
        {
            let mut queue = self.queue.lock().unwrap();
            queue.scheduled = false;
            queue.events.clear();
        }
    }
}

#[cfg(test)]
#[path = "../../../tests/native/test-browser-relay.rs"]
mod tests;
