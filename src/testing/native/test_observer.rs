#[path = "./terminal_lines.rs"]
mod lines;
#[path = "./test_signals.rs"]
mod signals;
#[path = "./test_tracker.rs"]
mod tracker;
#[path = "./test_types.rs"]
pub mod types;
pub use types::TestUpdate;

/** Incremental observer on the PTY reader, never on the webview/main thread. */
pub struct TestObserver {
    lines: lines::TerminalLines,
    tracker: tracker::Tracker,
}
impl TestObserver {
    pub fn new(id: &str) -> Self {
        Self {
            lines: lines::TerminalLines::default(),
            tracker: tracker::Tracker::new(id),
        }
    }
    pub fn push(&mut self, bytes: &[u8]) {
        let tracker = &mut self.tracker;
        self.lines
            .push(bytes, |line, redraw| tracker.line(line, redraw));
    }
    pub fn finish(&mut self) {
        let tracker = &mut self.tracker;
        self.lines.finish(|line, redraw| tracker.line(line, redraw));
        tracker.finish();
    }
    pub fn take_update(&mut self) -> Option<TestUpdate> {
        self.tracker.take_update()
    }
    pub fn has_update(&self) -> bool {
        self.tracker.has_update()
    }
    pub fn snapshot(&self) -> Option<TestUpdate> {
        self.tracker.run.as_ref().map(|run| TestUpdate {
            run: run.clone(),
            started: false,
            generation: self.tracker.generation,
            revision: self.tracker.revision,
        })
    }
}

#[cfg(test)]
#[path = "../../../tests/native/test-observer.rs"]
mod tests;
