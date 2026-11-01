use super::test_observer::{TestObserver, TestUpdate};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

struct State {
    observer: TestObserver,
    timer_scheduled: bool,
    main_scheduled: bool,
    pending: Option<TestUpdate>,
}
impl State {
    fn queue(&mut self, mut update: TestUpdate) -> bool {
        // If the main thread stalls, retain only the newest snapshot and its start.
        update.started |= self.pending.as_ref().is_some_and(|old| old.started);
        self.pending = Some(update);
        !std::mem::replace(&mut self.main_scheduled, true)
    }
}
pub struct TestOutput {
    state: Mutex<State>,
    event: String,
}
impl TestOutput {
    pub fn new(id: &str) -> Self {
        Self {
            state: Mutex::new(State {
                observer: TestObserver::new(id),
                timer_scheduled: false,
                main_scheduled: false,
                pending: None,
            }),
            event: format!("pty-test-{id}"),
        }
    }
    pub fn push(self: &Arc<Self>, app: &tauri::AppHandle, bytes: &[u8]) {
        let mut state = self.state.lock().unwrap();
        state.observer.push(bytes);
        if state.timer_scheduled || !state.observer.has_update() {
            return;
        }
        state.timer_scheduled = true;
        let (output, app) = (self.clone(), app.clone());
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(80)).await;
            let mut state = output.state.lock().unwrap();
            state.timer_scheduled = false;
            if let Some(update) = state.observer.take_update() {
                if state.queue(update) && !output.schedule(&app) {
                    state.main_scheduled = false;
                }
            }
        });
    }
    pub fn finish(self: &Arc<Self>, app: &tauri::AppHandle) {
        let mut state = self.state.lock().unwrap();
        state.observer.finish();
        if let Some(update) = state.observer.take_update() {
            if state.queue(update) && !self.schedule(app) {
                state.main_scheduled = false;
            }
        }
    }
    pub fn snapshot(&self) -> Option<TestUpdate> {
        self.state.lock().unwrap().observer.snapshot()
    }
    fn schedule(self: &Arc<Self>, app: &tauri::AppHandle) -> bool {
        let (handle, event, output) = (app.clone(), self.event.clone(), self.clone());
        app.run_on_main_thread(move || {
            let update = {
                let mut state = output.state.lock().unwrap();
                state.main_scheduled = false;
                state.pending.take()
            };
            if let Some(update) = update {
                let _ = handle.emit(&event, update);
            }
        })
        .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stalled_main_thread_keeps_only_the_latest_snapshot_and_run_start() {
        let output = TestOutput::new("bounded");
        let mut state = output.state.lock().unwrap();
        state.observer.push(b"Running 1 test using 1 worker\n");
        let first = state.observer.take_update().unwrap();
        assert!(state.queue(first));
        for _ in 0..100 {
            state.observer.push(b"ordinary output\n");
            let update = state.observer.take_update().unwrap();
            assert!(!state.queue(update));
        }
        state.observer.push(b"1 passed\n");
        let final_update = state.observer.take_update().unwrap();
        assert!(!state.queue(final_update));
        let pending = state.pending.take().unwrap();
        assert!(pending.started);
        assert_eq!(pending.run.status, "passed");
        assert_eq!(pending.run.passed, 1);
    }
}
