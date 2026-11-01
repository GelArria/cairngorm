// Quota windows parsed from each CLI's own usage report.
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageWindow {
    /// "session" (rolling hours) or "weekly".
    pub kind: String,
    pub label: String,
    pub used_percent: f64,
    /// Unix seconds when the CLI reports an exact reset time.
    pub resets_at: Option<i64>,
    /// Reset time as the CLI phrased it, when no timestamp is available.
    pub resets_text: Option<String>,
}

impl UsageWindow {
    /// A window whose reset time has passed is shown as reset, not with its old percentage.
    pub(crate) fn as_of(mut self, now: i64) -> Self {
        if self.resets_at.is_some_and(|at| at <= now) {
            self.used_percent = 0.0;
            self.resets_at = None;
        }
        self
    }
}

#[derive(Debug, Default)]
pub(crate) struct CodexUsage {
    pub plan: Option<String>,
    pub windows: Vec<UsageWindow>,
    /// Set when Codex reports usage is blocked, which the windows alone may not show.
    pub warning: Option<String>,
}

fn codex_window(window: &Value, now: i64) -> Option<UsageWindow> {
    let minutes = window["windowDurationMins"].as_i64().filter(|m| *m > 0)?;
    let (kind, label) = match minutes {
        300 => ("session", "5-hour".to_string()),
        10080 => ("weekly", "Weekly".to_string()),
        m if m < 1440 && m % 60 == 0 => ("session", format!("{}-hour", m / 60)),
        m if m < 1440 => ("session", format!("{m}-minute")),
        m => ("weekly", format!("{}-day", (m + 720) / 1440)),
    };
    let window = UsageWindow {
        kind: kind.into(),
        label,
        used_percent: window["usedPercent"].as_f64()?,
        resets_at: window["resetsAt"].as_i64(),
        resets_text: None,
    };
    Some(window.as_of(now))
}

pub(crate) fn parse_codex(result: &Value, now: i64) -> Result<CodexUsage, String> {
    let limits = &result["rateLimits"];
    let mut windows: Vec<UsageWindow> = ["primary", "secondary"]
        .iter()
        .filter_map(|key| codex_window(&limits[*key], now))
        .collect();
    // Shorter windows first: session, then week.
    windows.sort_by_key(|w| w.kind != "session");
    if windows.is_empty() {
        return Err("Codex did not report subscription limits for this account.".into());
    }
    let warning = if limits["spendControlReached"].as_bool() == Some(true) {
        Some("Spend limit reached. Codex is paused until the limit is raised.".to_string())
    } else if limits["rateLimitReachedType"].is_string() {
        Some("Codex reports that a usage limit is reached.".to_string())
    } else {
        None
    };
    Ok(CodexUsage {
        plan: limits["planType"].as_str().map(String::from),
        windows,
        warning,
    })
}
