use serde::Serialize;
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Passed,
    Failed,
    Skipped,
}
impl Status {
    pub fn index(self) -> usize {
        match self {
            Self::Passed => 0,
            Self::Failed => 1,
            Self::Skipped => 2,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct TestResult {
    pub name: String,
    pub status: Status,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub id: usize,
    pub session_id: String,
    pub runner: String,
    pub status: String,
    pub started_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<usize>,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub results: VecDeque<TestResult>,
    pub output: VecDeque<String>,
}
impl TestRun {
    pub fn count(&mut self, status: Status) -> &mut usize {
        match status {
            Status::Passed => &mut self.passed,
            Status::Failed => &mut self.failed,
            Status::Skipped => &mut self.skipped,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct TestUpdate {
    pub run: TestRun,
    pub started: bool,
    pub generation: u64,
    pub revision: u64,
}

#[derive(Default)]
pub struct Signal {
    pub runner: Option<&'static str>,
    pub start: bool,
    pub restart: bool,
    pub suite: Option<String>,
    pub package: Option<String>,
    pub total: Option<usize>,
    pub result: Option<TestResult>,
    pub counts: Option<[Option<usize>; 3]>,
    pub reset_counts: bool,
    pub end: bool,
    pub failed: bool,
}
