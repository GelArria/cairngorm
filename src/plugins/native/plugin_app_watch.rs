//! Watches an application while an agent's request runs in it, so a request never waits
//! blindly: a modal dialog, a cancelled request or the time limit each stop it with a specific
//! reason the agent can act on. "Not responding" never stops a request by itself: an
//! application runs a long COM call on its UI thread and looks hung while it works, so it
//! only explains a timeout.
use super::app_cancel::Token;
use std::time::{Duration, Instant};

/// A dialog this long is waiting for the user, not a progress flash.
const DIALOG_AFTER: Duration = Duration::from_secs(4);
const SCAN_EVERY: Duration = Duration::from_secs(1);
/// How long an application that was left busy gets to answer a trivial request.
pub const PROBE: Duration = Duration::from_secs(8);
const DEFAULT_SECONDS: u64 = 120;
/// The bridge's HTTP client gives up on a reply after 300 s, and consent may take 60 s first.
const MAX_SECONDS: u64 = 240;

pub static TIMEOUT_SCHEMA: std::sync::LazyLock<serde_json::Value> =
    std::sync::LazyLock::new(|| {
        serde_json::json!({"type": "integer", "minimum": 5, "maximum": MAX_SECONDS,
        "description": "Seconds the request may take (default 120)."})
    });

/// The time limit an agent asked for, kept within 5 s and 4 minutes.
pub fn limit(seconds: Option<u64>) -> Duration {
    Duration::from_secs(seconds.unwrap_or(DEFAULT_SECONDS).clamp(5, MAX_SECONDS))
}

/// What the application looks like right now.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Observation {
    /// Title, text and buttons of a modal dialog it shows.
    pub dialog: Option<String>,
    pub hung: bool,
    /// The platform lets Cairngorm see the application's windows (Windows only for now).
    pub observed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Stop {
    Cancelled,
    /// Whether the application looked busy on its UI thread when time ran out, and whether
    /// its windows could be seen at all.
    TimedOut {
        hung: bool,
        observed: bool,
    },
    Dialog(String),
}

impl Stop {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::TimedOut { .. } => "timed-out",
            Self::Dialog(_) => "app-dialog",
        }
    }

    pub fn message(&self, app: &str, timeout: Duration) -> String {
        let seconds = timeout.as_secs();
        match self {
            Self::Cancelled => "The request was cancelled; the script was stopped.".into(),
            Self::TimedOut {
                observed: false, ..
            } => format!(
                "{app} did not finish within {seconds} s. Cairngorm cannot see application \
                 windows on this platform, so a prompt may be waiting: the system asking whether \
                 Cairngorm may control {app}, or a dialog in {app}. Ask the user to check, then \
                 retry (with a larger timeoutSeconds if the work is long)."
            ),
            Self::TimedOut { hung: true, .. } => format!(
                "{app} did not finish within {seconds} s and is still busy with the call (it \
                 shows no dialog). Long work such as exporting or opening a large file needs a \
                 larger timeoutSeconds; the next request first checks that {app} answers again."
            ),
            Self::TimedOut { hung: false, .. } => format!(
                "{app} did not finish within {seconds} s although it showed no dialog and kept \
                 responding, so the operation is blocked inside the application (for example, \
                 Office without a valid license cannot save) or needs a larger timeoutSeconds. \
                 Tell the user what you were doing when it stopped."
            ),
            Self::Dialog(text) => format!(
                "{app} is showing a dialog and waits for an answer: \u{201c}{text}\u{201d}. \
                 Nothing was dismissed and {app} was left open. Tell the user; they can answer \
                 it in {app} (shown beside the terminal), then retry."
            ),
        }
    }
}

/// Decides when a request must stop. Pure: observations come from `observe`.
pub struct Watch {
    started: Instant,
    timeout: Duration,
    cancel: Option<Token>,
    dialog: Option<(String, Instant)>,
    hung: bool,
    observed: bool,
    scanned: Option<Instant>,
}

impl Watch {
    pub fn new(timeout: Duration, cancel: Option<Token>) -> Self {
        Self {
            started: Instant::now(),
            timeout,
            cancel,
            dialog: None,
            hung: false,
            observed: false,
            scanned: None,
        }
    }

    /// Whether an observation of the application is due (about once a second).
    pub fn scan_due(&mut self, now: Instant) -> bool {
        let due = self.scanned.map_or(true, |at| now - at >= SCAN_EVERY);
        if due {
            self.scanned = Some(now);
        }
        due
    }

    /// Feeds what the application looks like (when scanned) and returns why to stop, if so.
    pub fn check(&mut self, now: Instant, seen: Option<&Observation>) -> Option<Stop> {
        if self.cancel.as_ref().is_some_and(Token::cancelled) {
            return Some(Stop::Cancelled);
        }
        if let Some(seen) = seen {
            self.dialog = match (&seen.dialog, self.dialog.take()) {
                (Some(text), Some((same, since))) if *text == same => Some((same, since)),
                (Some(text), _) => Some((text.clone(), now)),
                (None, _) => None,
            };
            self.hung = seen.hung;
            self.observed = seen.observed;
        }
        if let Some((text, since)) = &self.dialog {
            if now - *since >= DIALOG_AFTER {
                return Some(Stop::Dialog(text.clone()));
            }
        }
        (now - self.started >= self.timeout).then_some(Stop::TimedOut {
            hung: self.hung,
            observed: self.observed,
        })
    }
}

/// What the processes of `executable` look like now (nothing is observed off Windows yet).
pub fn observe(executable: &str) -> Observation {
    #[cfg(windows)]
    {
        win::observe(&super::app_window::pids(executable))
    }
    #[cfg(not(windows))]
    {
        let _ = executable;
        Observation::default()
    }
}

#[cfg(windows)]
#[path = "plugin_app_watch_win.rs"]
pub(super) mod win;

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_watch.rs"]
mod tests;
