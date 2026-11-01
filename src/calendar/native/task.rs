use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub project_id: String,
    pub project_name: String,
    pub root_path: String,
    pub agent: String,
    pub next_at: u64,
    pub interval_minutes: Option<u64>,
}

impl TaskInput {
    pub fn validate(&mut self) -> Result<(), String> {
        self.title = self.title.trim().into();
        self.prompt = self.prompt.trim().into();
        self.validate_definition()?;
        if self.next_at <= now() || self.next_at > now() + 315_360_000 {
            return Err("Choose a future start time within ten years.".into());
        }
        let root = Path::new(&self.root_path);
        if !root.is_absolute() || !root.is_dir() {
            return Err("The project must have an existing absolute folder path.".into());
        }
        self.root_path = root
            .canonicalize()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        Ok(())
    }

    pub fn validate_definition(&self) -> Result<(), String> {
        if self.title.is_empty()
            || self.title.len() > 200
            || self.prompt.is_empty()
            || self.prompt.len() > 20_000
        {
            return Err(
                "A title (up to 200 bytes) and instructions (up to 20,000 bytes) are required."
                    .into(),
            );
        }
        if self.project_id.is_empty()
            || self.project_id.len() > 100
            || self.project_name.len() > 200
        {
            return Err("Choose a project.".into());
        }
        if !matches!(self.agent.as_str(), "cairngorm" | "codex" | "gemini") {
            return Err("Choose a supported agent.".into());
        }
        if self.interval_minutes.is_some_and(|n| n == 0 || n > 525_600) {
            return Err("The interval must be between 1 and 525,600 minutes.".into());
        }
        if self.next_at > 253_402_300_799 || !Path::new(&self.root_path).is_absolute() {
            return Err("Invalid scheduled time or project folder.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(flatten)]
    pub input: TaskInput,
    pub enabled: bool,
    pub requested: bool,
    pub status: String,
    pub last_run: Option<u64>,
    pub output: String,
    /// Files the last run changed ("<status> <path>"); absent outside Git projects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changes: Option<Vec<String>>,
}

impl Task {
    pub fn due(&self, time: u64) -> bool {
        self.status != "running" && (self.requested || (self.enabled && self.input.next_at <= time))
    }

    pub fn claim(&mut self, time: u64) {
        self.requested = false;
        self.status = "running".into();
        self.last_run = Some(time);
        self.output.clear();
        self.changes = None;
        if let Some(minutes) = self.input.interval_minutes {
            // Missed occurrences coalesce into one run, never a catch-up burst.
            self.input.next_at = time + minutes * 60;
        } else {
            self.enabled = false;
        }
    }
}
