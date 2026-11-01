//! First-use consent for agent tools, per subject: "files" (file tools) or "app:<id>" (running
//! scripts in one installed application). Until the user chooses "Always allow" (stored in
//! settings; for an application it covers only the project it was given in), the first call
//! from a terminal session asks; "This terminal" covers that session and subject only,
//! "Don't allow" refuses. Changing scopes revokes session grants.
use super::{catalog::AppGrant, file_runtime::Scope, file_scope::FileError};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

/// After "Don't allow", calls from that terminal are refused without asking again for a while,
/// so a retrying agent cannot keep raising the dialog.
const DENY_COOLDOWN: Duration = Duration::from_secs(30);
const SEEN_TIMEOUT: Duration = Duration::from_secs(5);
pub const FILES: &str = "files";

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ConsentDecision {
    Always,
    Session,
    Deny,
}

pub(super) struct Pending {
    pub epoch: String,
    pub subject: String,
    /// The terminal's project: an application's "Always" is granted there only.
    pub project: String,
    /// The main window showed the question.
    pub seen: bool,
    pub created: Instant,
    pub reply: mpsc::Sender<bool>,
}

#[derive(Default)]
pub(super) struct Consent {
    /// "Always allow" for file tools (persisted as `files_enabled`).
    pub always: bool,
    /// Applications always allowed, each in one project (persisted as `app_grants`).
    pub always_apps: HashSet<AppGrant>,
    pub(super) sessions: HashSet<String>,
    pub(super) denied: HashMap<String, Instant>,
    pub(super) pending: HashMap<String, Pending>,
}

fn key(epoch: &str, subject: &str) -> String {
    format!("{epoch}|{subject}")
}

pub(super) fn grant(app: &str, project: &str) -> AppGrant {
    AppGrant {
        app: app.to_string(),
        project_id: project.to_string(),
    }
}

/// What a reply answered: its subject and the project of the terminal that asked.
pub(super) struct Answered {
    pub subject: String,
    pub project: String,
}

impl Consent {
    fn always_for(&self, subject: &str, project: &str) -> bool {
        match subject.strip_prefix("app:") {
            Some(app) => self.always_apps.contains(&grant(app, project)),
            None => self.always,
        }
    }

    pub fn allowed(&self, scope: &Scope, subject: &str) -> bool {
        self.always_for(subject, &scope.metadata.project_id)
            || self.sessions.contains(&key(&scope.epoch, subject))
    }

    /// Ends every grant and question (pending calls are refused).
    pub fn clear(&mut self) {
        self.sessions.clear();
        self.denied.clear();
        self.pending.clear();
    }

    /// Ends file session grants but leaves open questions for the user to answer.
    pub fn clear_sessions(&mut self) {
        let suffix = format!("|{FILES}");
        self.sessions.retain(|k| !k.ends_with(&suffix));
    }

    /// "Always allow" for files chosen elsewhere: every open file question is answered yes.
    pub fn grant_all(&mut self) {
        self.always = true;
        self.answer(|p| p.subject == FILES);
    }

    fn answer(&mut self, covered: impl Fn(&Pending) -> bool) {
        let ids: Vec<String> = self
            .pending
            .iter()
            .filter(|(_, p)| covered(p))
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(pending) = self.pending.remove(&id) {
                let _ = pending.reply.send(true);
            }
        }
    }

    fn recently_denied(&self, scope: &Scope, subject: &str) -> bool {
        self.denied
            .get(&key(&scope.epoch, subject))
            .is_some_and(|at| at.elapsed() < DENY_COOLDOWN)
    }

    /// Keeps session grants and questions only for scopes that still exist.
    pub fn retain(&mut self, epochs: &HashSet<String>) {
        let live = |k: &String| k.split('|').next().is_some_and(|e| epochs.contains(e));
        self.sessions.retain(|k| live(k));
        self.denied.retain(|k, _| live(k));
        self.pending.retain(|_, p| {
            epochs.contains(&p.epoch) && p.created.elapsed() < super::file_permissions::TIMEOUT
        });
    }

    fn ask(
        &mut self,
        scope: &Scope,
        subject: &str,
    ) -> Result<(String, mpsc::Receiver<bool>), FileError> {
        if self.pending.len() >= 16 {
            return Err(FileError::new(
                "permission-queue-full",
                "Too many pending approvals.",
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (reply, receiver) = mpsc::channel();
        let pending = Pending {
            epoch: scope.epoch.clone(),
            subject: subject.to_string(),
            project: scope.metadata.project_id.clone(),
            seen: false,
            created: Instant::now(),
            reply,
        };
        self.pending.insert(id.clone(), pending);
        Ok((id, receiver))
    }

    pub fn mark_seen(&mut self, id: &str) {
        if let Some(pending) = self.pending.get_mut(id) {
            pending.seen = true;
        }
    }

    /// Answers one question; a grant also answers the questions it covers (same subject; same
    /// terminal unless always, and an application's "Always" only in the same project).
    pub fn reply(&mut self, id: &str, decision: ConsentDecision) -> Result<Answered, String> {
        let pending = self
            .pending
            .remove(id)
            .ok_or("This request is no longer pending.")?;
        let subject = pending.subject.clone();
        let project = pending.project.clone();
        let session = key(&pending.epoch, &subject);
        let app = subject.starts_with("app:");
        match decision {
            ConsentDecision::Always => match subject.strip_prefix("app:") {
                Some(app) => {
                    self.always_apps.insert(grant(app, &project));
                }
                None => self.always = true,
            },
            ConsentDecision::Session => {
                self.sessions.insert(session.clone());
            }
            ConsentDecision::Deny => {
                self.denied.insert(session.clone(), Instant::now());
            }
        }
        let allowed = decision != ConsentDecision::Deny;
        let _ = pending.reply.send(allowed);
        if allowed {
            let always = decision == ConsentDecision::Always;
            self.answer(|p| {
                p.subject == subject
                    && if always {
                        !app || p.project == project
                    } else {
                        key(&p.epoch, &p.subject) == session
                    }
            });
        }
        Ok(Answered { subject, project })
    }
}

/// Returns once the user allowed `subject` for this terminal; asks the first time.
/// `label` names it in the dialog ("files" or the application's name).
pub(super) fn require(
    scope: &Arc<Scope>,
    subject: &str,
    label: &str,
    notify: &dyn Fn(serde_json::Value),
) -> Result<(), FileError> {
    let what = if subject == FILES {
        "Cairngorm file access".to_string()
    } else {
        format!("agents to control {label}")
    };
    let refused = format!("The user did not allow {what} for this terminal.");
    let (id, receiver) = {
        let mut runtime = super::file_runtime::runtime()
            .lock()
            .map_err(|e| FileError::new("file-unavailable", e.to_string()))?;
        if runtime.consent.allowed(scope, subject) {
            return Ok(());
        }
        if runtime.consent.recently_denied(scope, subject) {
            return Err(FileError::new(
                "not-authorized",
                format!("{refused} Do not retry."),
            ));
        }
        runtime.consent.ask(scope, subject)?
    };
    notify(serde_json::json!({
        "requestId": id, "access": "consent", "subject": subject, "label": label,
        "terminal": scope.metadata.session_id, "projectId": scope.metadata.project_id,
        "rootPath": scope.metadata.root_path, "path": scope.metadata.root_path, "directory": false,
    }));
    // The window acknowledges the question at once; without that, nobody can answer it.
    let answer = match receiver.recv_timeout(SEEN_TIMEOUT) {
        Ok(answer) => Some(answer),
        Err(mpsc::RecvTimeoutError::Disconnected) => Some(false),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let seen = super::file_runtime::runtime()
                .lock()
                .is_ok_and(|runtime| runtime.consent.pending.get(&id).is_some_and(|p| p.seen));
            seen.then(|| {
                receiver
                    .recv_timeout(super::file_permissions::TIMEOUT - SEEN_TIMEOUT)
                    .unwrap_or(false)
            })
        }
    };
    if let Ok(mut runtime) = super::file_runtime::runtime().lock() {
        runtime.consent.pending.remove(&id);
    }
    match answer {
        None => Err(FileError::new(
            "dialog-unavailable",
            "Cairngorm could not show its permission dialog. Ask the user to restart Cairngorm.",
        )),
        Some(true) => Ok(()),
        Some(false) => Err(FileError::new("not-authorized", refused)),
    }
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_file_consent.rs"]
mod tests;
