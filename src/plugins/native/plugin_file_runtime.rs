//! Session-only file capabilities. Scope changes revoke pending approvals and grants.
use super::{
    file_consent::Consent,
    file_permissions::Permissions,
    file_scope::{FileError, ProjectScope},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalFileScope {
    pub session_id: String,
    pub project_id: String,
    pub root_path: String,
}

pub(super) struct Scope {
    pub metadata: TerminalFileScope,
    pub root: Arc<ProjectScope>,
    pub epoch: String,
}

#[derive(Default)]
pub(super) struct FileRuntime {
    pub enabled: bool,
    metadata: Vec<TerminalFileScope>,
    pub scopes: HashMap<String, Arc<Scope>>,
    pub permissions: Permissions,
    pub consent: Consent,
    dirty_paths: Vec<String>,
}

pub(super) fn runtime() -> &'static Mutex<FileRuntime> {
    static RUNTIME: OnceLock<Mutex<FileRuntime>> = OnceLock::new();
    RUNTIME.get_or_init(Default::default)
}

impl FileRuntime {
    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled == enabled {
            return;
        }
        self.enabled = enabled;
        self.scopes.clear();
        self.permissions.clear();
        self.consent.clear();
        self.rebuild();
        super::catalog::changed();
    }

    pub fn sync(
        &mut self,
        terminals: Vec<TerminalFileScope>,
        dirty_paths: Vec<String>,
    ) -> Result<bool, String> {
        if terminals.len() > 4096 || dirty_paths.len() > 4096 {
            return Err("Too many workspace entries.".into());
        }
        let mut ids = std::collections::HashSet::new();
        if terminals.iter().any(|t| {
            t.session_id.is_empty()
                || t.session_id.len() > 128
                || t.project_id.is_empty()
                || t.project_id.len() > 128
                || t.root_path.len() > 32_768
                || !ids.insert(t.session_id.clone())
        }) {
            return Err("Invalid terminal file scope.".into());
        }
        self.metadata = terminals;
        self.dirty_paths = dirty_paths;
        let changed = self.rebuild();
        if changed {
            super::catalog::changed();
        }
        Ok(changed)
    }

    fn rebuild(&mut self) -> bool {
        let before: std::collections::HashSet<_> = self.scopes.keys().cloned().collect();
        self.scopes
            .retain(|_, scope| self.enabled && self.metadata.contains(&scope.metadata));
        for metadata in &self.metadata {
            if !self.enabled || self.scopes.contains_key(&metadata.session_id) {
                continue;
            }
            if let Ok(root) = ProjectScope::new(Path::new(&metadata.root_path)) {
                self.scopes.insert(
                    metadata.session_id.clone(),
                    Arc::new(Scope {
                        metadata: metadata.clone(),
                        root: Arc::new(root),
                        epoch: uuid::Uuid::new_v4().to_string(),
                    }),
                );
            }
        }
        self.permissions.retain(&self.scopes);
        let epochs = self.scopes.values().map(|s| s.epoch.clone()).collect();
        self.consent.retain(&epochs);
        before.len() != self.scopes.len() || self.scopes.keys().any(|id| !before.contains(id))
    }

    pub fn scope(&self, terminal: &str) -> Result<Arc<Scope>, FileError> {
        if !self.enabled {
            return Err(FileError::new("files-disabled", "File access is disabled."));
        }
        self.scopes.get(terminal).cloned().ok_or_else(|| {
            FileError::new(
                "missing-scope",
                "File access requires a live terminal with a project folder.",
            )
        })
    }

    pub fn current(&self, scope: &Arc<Scope>) -> bool {
        self.enabled
            && self
                .scopes
                .get(&scope.metadata.session_id)
                .is_some_and(|current| Arc::ptr_eq(scope, current))
    }
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_files.rs"]
mod tests;
