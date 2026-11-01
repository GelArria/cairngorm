use super::{
    signals::signal,
    types::{Status, TestRun, TestUpdate},
};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub struct Tracker {
    session_id: String,
    pub run: Option<TestRun>,
    failed: bool,
    keys: HashMap<String, Status>,
    key_order: VecDeque<String>,
    headers: VecDeque<String>,
    go_names: HashSet<String>,
    go_verbose: bool,
    suite: String,
    baseline: [usize; 4],
    dirty: bool,
    pub generation: u64,
    pub revision: u64,
    started: bool,
}
impl Tracker {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.into(),
            run: None,
            failed: false,
            keys: HashMap::new(),
            key_order: VecDeque::new(),
            headers: VecDeque::new(),
            go_names: HashSet::new(),
            go_verbose: false,
            suite: String::new(),
            baseline: [0; 4],
            dirty: false,
            generation: NEXT_GENERATION.fetch_add(1, Ordering::Relaxed),
            revision: 0,
            started: false,
        }
    }
    fn start(&mut self, runner: &str) {
        self.failed = false;
        self.suite.clear();
        self.go_verbose = false;
        self.baseline = [0; 4];
        self.keys.clear();
        self.key_order.clear();
        self.go_names.clear();
        self.run = Some(TestRun {
            id: self.run.as_ref().map_or(1, |r| r.id + 1),
            session_id: self.session_id.clone(),
            runner: runner.into(),
            status: "running".into(),
            started_at: now(),
            ended_at: None,
            total: None,
            passed: 0,
            failed: 0,
            skipped: 0,
            results: VecDeque::new(),
            output: VecDeque::new(),
        });
        self.started = true;
        self.dirty = true;
        self.revision += 1;
    }
    pub fn line(&mut self, line: String, redraw: bool) {
        let runner = self
            .run
            .as_ref()
            .filter(|r| r.status == "running")
            .map(|r| r.runner.as_str());
        let s = signal(&line, runner);
        if redraw
            && self.run.as_ref().is_some_and(|r| r.status != "running")
            && (!s.start || self.headers.iter().any(|h| h == line.trim()))
        {
            return;
        }
        if let Some(suite) = s.suite {
            if self.run.is_none() {
                self.start("Cargo");
            }
            let r = self.run.as_mut().unwrap();
            if r.runner != "Cargo" {
                return;
            }
            self.baseline = [r.passed, r.failed, r.skipped, r.total.unwrap_or(0)];
            self.suite = suite;
            r.status = "running".into();
            r.ended_at = None;
        }
        if s.start {
            if self.run.as_ref().is_some_and(|r| {
                r.status == "running" && r.runner != "Tests" && Some(r.runner.as_str()) != s.runner
            }) {
                return;
            }
            let next_go = self.run.as_ref().is_some_and(|r| r.runner == "Go")
                && self.go_verbose
                && s.runner == Some("Go")
                && !s.restart;
            if self
                .run
                .as_ref()
                .is_none_or(|r| r.status != "running" && !next_go)
                || s.restart
            {
                self.start(s.runner.unwrap());
            }
            let r = self.run.as_mut().unwrap();
            r.runner = s.runner.unwrap().into();
            r.status = "running".into();
            r.ended_at = None;
            let header = line.trim();
            if !self.headers.iter().any(|h| h == header) {
                self.headers.push_back(header.into());
            }
            if self.headers.len() > 128 {
                self.headers.pop_front();
            }
            if s.runner == Some("Go") {
                self.go_verbose = true;
            }
        } else if let Some(package) = &s.package {
            if self.run.as_ref().is_none_or(|r| r.runner != "Go") || self.keys.contains_key(package)
            {
                self.start("Go");
            }
            let r = self.run.as_mut().unwrap();
            r.status = "running".into();
            r.ended_at = None;
        } else if self.run.is_none() && s.runner.is_some() && (s.result.is_some() || s.end) {
            self.start(s.runner.unwrap());
        }
        let Some(r) = self.run.as_mut() else {
            return;
        };
        if r.status != "running" && s.counts.is_none() && !s.end {
            return;
        }
        r.output.push_back(line.chars().take(16384).collect());
        if r.output.len() > 600 {
            r.output.pop_front();
        }
        if let Some(package) = &s.package {
            for row in &mut r.results {
                if self.go_names.contains(&row.name) {
                    row.name = format!("{package} › {}", row.name);
                }
            }
            for name in self.go_names.drain() {
                if let Some(status) = self.keys.remove(&name) {
                    let key = format!("{package} › {name}");
                    self.keys.insert(key.clone(), status);
                    self.key_order.push_back(key);
                }
                self.key_order.retain(|key| key != &name);
            }
        }
        if let Some(total) = s.total {
            r.total = Some(total.saturating_add(self.baseline[3]));
        }
        self.failed |= s.failed;
        if let Some(mut row) = s.result {
            if !self.suite.is_empty() {
                row.name = format!("{} › {}", self.suite, row.name);
            }
            if r.runner == "Go" && s.package.is_none() {
                self.go_names.insert(row.name.clone());
            }
            let previous = self.keys.get(&row.name).copied();
            if previous != Some(row.status) {
                if previous.is_none() {
                    self.key_order.push_back(row.name.clone());
                }
                self.keys.insert(row.name.clone(), row.status);
                if self.keys.len() > 10000 {
                    if let Some(key) = self.key_order.pop_front() {
                        self.keys.remove(&key);
                        self.go_names.remove(&key);
                    }
                }
                if s.package.is_none() || !self.go_verbose {
                    if let Some(status) = previous {
                        *r.count(status) = r.count(status).saturating_sub(1);
                    }
                    *r.count(row.status) = r.count(row.status).saturating_add(1);
                }
                r.results.retain(|old| old.name != row.name);
                r.results.push_back(row);
                if r.results.len() > 500 {
                    r.results.pop_front();
                }
            }
        }
        if let Some(c) = s.counts {
            for status in [Status::Passed, Status::Failed, Status::Skipped] {
                let i = status.index();
                if let Some(value) = c[i] {
                    *r.count(status) = value.saturating_add(self.baseline[i]);
                } else if s.reset_counts {
                    *r.count(status) = self.baseline[i];
                }
            }
        }
        if s.end {
            r.status = if self.failed || r.failed > 0 {
                "failed"
            } else {
                "passed"
            }
            .into();
            r.ended_at = Some(now());
        }
        self.dirty = true;
        self.revision += 1;
    }
    pub fn finish(&mut self) {
        if let Some(r) = &mut self.run {
            if r.status == "running" {
                r.status = "interrupted".into();
                r.ended_at = Some(now());
                self.dirty = true;
                self.revision += 1;
            }
        }
    }
    pub fn has_update(&self) -> bool {
        self.dirty
    }
    pub fn take_update(&mut self) -> Option<TestUpdate> {
        if !std::mem::take(&mut self.dirty) {
            return None;
        }
        Some(TestUpdate {
            run: self.run.as_ref()?.clone(),
            started: std::mem::take(&mut self.started),
            generation: self.generation,
            revision: self.revision,
        })
    }
}
