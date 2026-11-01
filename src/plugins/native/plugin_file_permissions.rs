//! Approvals contain native-stored paths, never paths supplied by a reply.
use super::{
    file_runtime::Scope,
    file_scope::{FileError, ProjectScope},
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

pub(super) const TIMEOUT: Duration = Duration::from_secs(60);
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Deny,
    File,
    Folder,
}

struct Pending {
    scope: Arc<Scope>,
    path: PathBuf,
    directory: bool,
    created: Instant,
    reply: mpsc::Sender<Option<Grant>>,
}
#[derive(Clone)]
pub(super) struct Grant {
    epoch: String,
    terminal: String,
    path: PathBuf,
    folder: bool,
    pub root: Arc<ProjectScope>,
}
impl Grant {
    fn allows(&self, scope: &Scope, path: &std::path::Path) -> bool {
        self.epoch == scope.epoch
            && self.terminal == scope.metadata.session_id
            && (self.path == path || self.folder && path.starts_with(&self.path))
    }
}
#[derive(Default)]
pub(super) struct Permissions {
    pending: HashMap<String, Pending>,
    grants: Vec<Grant>,
}
impl Permissions {
    pub fn clear(&mut self) {
        self.pending.clear();
        self.grants.clear();
    }
    pub fn retain(&mut self, scopes: &HashMap<String, Arc<Scope>>) {
        self.pending.retain(|_, p| {
            p.created.elapsed() < TIMEOUT
                && scopes
                    .get(&p.scope.metadata.session_id)
                    .is_some_and(|s| Arc::ptr_eq(s, &p.scope))
        });
        self.grants
            .retain(|g| scopes.get(&g.terminal).is_some_and(|s| s.epoch == g.epoch));
    }
    pub fn granted(&self, scope: &Scope, path: &std::path::Path) -> Option<Arc<ProjectScope>> {
        self.grants
            .iter()
            .find(|g| g.allows(scope, path))
            .map(|g| g.root.clone())
    }
    pub fn request(
        &mut self,
        scope: Arc<Scope>,
        path: PathBuf,
        directory: bool,
    ) -> Result<(String, mpsc::Receiver<Option<Grant>>), FileError> {
        self.pending.retain(|_, p| p.created.elapsed() < TIMEOUT);
        if self.pending.len() >= 16 {
            return Err(FileError::new(
                "permission-queue-full",
                "Too many pending file approvals.",
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (reply, receiver) = mpsc::channel();
        self.pending.insert(
            id.clone(),
            Pending {
                scope,
                path,
                directory,
                created: Instant::now(),
                reply,
            },
        );
        Ok((id, receiver))
    }
    pub fn cancel(&mut self, id: &str) {
        self.pending.remove(id);
    }
    pub fn reply(&mut self, id: &str, decision: Decision) -> Result<(), String> {
        let pending = self
            .pending
            .remove(id)
            .ok_or("This file approval is no longer pending.")?;
        if pending.created.elapsed() >= TIMEOUT {
            return Err("This file approval expired.".into());
        }
        if matches!(decision, Decision::Deny) {
            let _ = pending.reply.send(None);
            return Ok(());
        }
        if pending.directory && matches!(decision, Decision::File) {
            return Err("Directory listing requires folder approval.".into());
        }
        let folder = matches!(decision, Decision::Folder);
        let root_path = if folder && pending.directory {
            pending.path.as_path()
        } else {
            pending.path.parent().ok_or("Missing parent folder")?
        };
        let root = Arc::new(ProjectScope::new(root_path).map_err(|e| e.message)?);
        let path = if folder {
            root.root_path().to_path_buf()
        } else {
            root.resolve(
                pending
                    .path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("Invalid file name")?,
            )
            .map_err(|e| e.message)?
        };
        let grant = Grant {
            epoch: pending.scope.epoch.clone(),
            terminal: pending.scope.metadata.session_id.clone(),
            path,
            folder,
            root,
        };
        if self.grants.len() >= 256 {
            return Err("Too many file grants. Disable file access to clear them.".into());
        }
        // Do not retain a grant when its original request has already stopped waiting.
        pending
            .reply
            .send(Some(grant.clone()))
            .map_err(|_| "The file request was cancelled.")?;
        self.grants.push(grant);
        Ok(())
    }
}

pub(super) fn request_access(
    scope: Arc<Scope>,
    path: PathBuf,
    directory: bool,
    notify: impl FnOnce(serde_json::Value),
) -> Result<Arc<ProjectScope>, FileError> {
    let (id, receiver) = {
        let mut runtime = super::file_runtime::runtime()
            .lock()
            .map_err(|e| FileError::new("file-unavailable", e.to_string()))?;
        if !runtime.current(&scope) {
            return Err(denied());
        }
        if let Some(root) = runtime.permissions.granted(&scope, &path) {
            return Ok(root);
        }
        runtime
            .permissions
            .request(scope.clone(), path.clone(), directory)?
    };
    notify(
        serde_json::json!({"requestId": id, "terminal": scope.metadata.session_id,
        "projectId": scope.metadata.project_id, "rootPath": scope.metadata.root_path,
        "path": path, "access": "read", "directory": directory}),
    );
    let result = receiver
        .recv_timeout(TIMEOUT)
        .ok()
        .flatten()
        .map(|g| g.root)
        .ok_or_else(denied);
    if let Ok(mut runtime) = super::file_runtime::runtime().lock() {
        runtime.permissions.cancel(&id);
    }
    result
}
#[cfg(test)]
#[path = "../../../tests/native/plugin_file_permissions.rs"]
mod tests;

fn denied() -> FileError {
    FileError::new("not-authorized", "File access was not authorized.")
}
