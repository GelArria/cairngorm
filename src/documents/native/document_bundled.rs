//! Document providers shipped inside Cairngorm. They install like any approved bundle (same
//! validation, isolation and approval record); the user's click is the approval.
use super::{
    bundle, install,
    manifest::{self, Manifest},
};
use serde::Serialize;
use std::{fs, path::Path, sync::Mutex};

/// Ids only bundles shipped with Cairngorm may use, so an installed one is always ours.
const RESERVED_PREFIX: &str = "app.cairngorm.";

type Files = &'static [(&'static str, &'static [u8])];

macro_rules! bundle {
    ($dir:literal: $($file:literal),+ $(,)?) => {
        &[$(($file, include_bytes!(concat!("../providers/", $dir, "/", $file)))),+]
    };
}

/// Compiled output only: TypeScript sources and build configuration stay in the repository.
const BUNDLED: &[(&str, Files)] = &[(
    "spreadsheet",
    bundle!("spreadsheet": "cairngorm-provider.json", "index.html", "styles.css", "main.js",
        "grid.js", "grid-render.js", "session.js", "workbook.js", "edits.js", "rules.js",
        "protect.js", "zip.js", "cells.js", "layout.js", "clipboard.js", "blank.xlsx"),
)];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundled {
    pub name: &'static str,
    pub manifest: Manifest,
    /// Installed and approved with exactly these bundled bytes.
    pub installed: bool,
}

fn files(name: &str) -> Result<Files, String> {
    BUNDLED
        .iter()
        .find(|(id, _)| *id == name)
        .map(|(_, files)| *files)
        .ok_or_else(|| format!("No bundled document provider named {name}."))
}

fn bundled_manifest(files: Files) -> Result<Manifest, String> {
    let (_, bytes) = files
        .iter()
        .find(|(file, _)| *file == manifest::MANIFEST_FILE)
        .ok_or("The bundled provider has no manifest.")?;
    manifest::parse(bytes)
}

pub fn reserved(id: &str) -> bool {
    id.starts_with(RESERVED_PREFIX)
}

fn bundle_hash(files: Files) -> String {
    let mut owned: Vec<(String, Vec<u8>)> = files
        .iter()
        .map(|(name, bytes)| (name.to_string(), bytes.to_vec()))
        .collect();
    owned.sort_by(|a, b| a.0.cmp(&b.0));
    bundle::hash(&owned)
}

fn current(root: &Path, id: &str, files: Files) -> bool {
    install::approved(root, id).is_some()
        && install::recorded_hash(root, id).is_some_and(|hash| hash == bundle_hash(files))
}

pub fn list(root: &Path) -> Vec<Bundled> {
    BUNDLED
        .iter()
        .filter_map(|(name, files)| {
            let manifest = bundled_manifest(files).ok()?;
            let installed = current(root, &manifest.id, files);
            Some(Bundled {
                name,
                manifest,
                installed,
            })
        })
        .collect()
}

/// Bundled ids the user removed: they stay removed until added again from Settings.
const REMOVED: &str = ".bundled-removed.json";

fn removed(root: &Path) -> Vec<String> {
    fs::read(root.join(REMOVED))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Records (or clears) a removal of a bundled provider by the user.
pub fn set_removed(root: &Path, id: &str, gone: bool) {
    let mut ids = removed(root);
    ids.retain(|entry| entry != id);
    if gone {
        ids.push(id.to_string());
    }
    let _ = fs::create_dir_all(root);
    // Written whole and renamed, so a failed write never forgets earlier removals.
    let temporary = root.join(format!("{REMOVED}.tmp"));
    if fs::write(&temporary, serde_json::to_vec(&ids).unwrap_or_default()).is_ok() {
        let _ = fs::rename(&temporary, root.join(REMOVED));
    }
}

/// Included providers work out of the box: each one not removed by the user is installed,
/// or replaced when this build ships different bytes. Reserved ids make this safe.
pub fn refresh(root: &Path) -> bool {
    let removed = removed(root);
    let mut changed = false;
    for (name, files) in BUNDLED {
        let Ok(manifest) = bundled_manifest(files) else {
            continue;
        };
        if !removed.contains(&manifest.id) && !current(root, &manifest.id, files) {
            changed |= install_bundled(root, name).is_ok();
        }
    }
    changed
}

/// `refresh` once per run; callers arriving meanwhile wait for it, so an agent creating a
/// workbook at startup finds the included editor installed.
pub fn refresh_once(root: &Path) -> bool {
    static DONE: Mutex<bool> = Mutex::new(false);
    let mut done = DONE.lock().unwrap_or_else(|e| e.into_inner());
    if *done {
        return false;
    }
    *done = true;
    refresh(root)
}

/// Writes the bundle to a private staging folder and installs it through the normal path.
pub fn install_bundled(root: &Path, name: &str) -> Result<Manifest, String> {
    let files = files(name)?;
    let staging = root.join(format!(".bundled-{}", uuid::Uuid::new_v4().simple()));
    let result = (|| {
        for (file, bytes) in files {
            fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
            fs::write(staging.join(file), bytes).map_err(|e| e.to_string())?;
        }
        let reviewed = install::inspect(root, &staging)?;
        install::install(root, &staging, &reviewed.approval_hash)
    })();
    if let Ok(manifest) = &result {
        set_removed(root, &manifest.id, false);
    }
    let _ = fs::remove_dir_all(&staging);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_providers_validate_and_install_like_any_other() {
        let root = std::env::temp_dir().join(format!("cairngorm-bundled-{}", uuid::Uuid::new_v4()));
        let listed = list(&root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].manifest.id, "app.cairngorm.spreadsheet");
        assert!(listed[0]
            .manifest
            .capabilities
            .contains(&"edit".to_string()));
        assert!(!listed[0].installed);
        let installed = install_bundled(&root, "spreadsheet").unwrap();
        assert_eq!(installed.file_types[0].extensions, vec!["xlsx"]);
        assert!(list(&root)[0].installed);
        assert!(install::approved(&root, "app.cairngorm.spreadsheet").is_some());
        // Files from another build no longer count as installed, and are replaced once per run.
        fs::write(
            root.join("app.cairngorm.spreadsheet").join("main.js"),
            b"old",
        )
        .unwrap();
        install::invalidate();
        assert!(!list(&root)[0].installed);
        assert!(refresh(&root));
        assert!(list(&root)[0].installed);
        assert!(!refresh(&root));
        // A removed bundled provider stays removed; adding it again clears that.
        install::remove(&root, "app.cairngorm.spreadsheet").unwrap();
        set_removed(&root, "app.cairngorm.spreadsheet", true);
        assert!(!refresh(&root));
        assert!(!list(&root)[0].installed);
        install_bundled(&root, "spreadsheet").unwrap();
        assert!(removed(&root).is_empty());
        // A fresh data folder gets every included provider without asking.
        let fresh = root.join("fresh");
        assert!(refresh(&fresh));
        assert!(list(&fresh)[0].installed);
        assert!(reserved("app.cairngorm.anything") && !reserved("com.example.viewer"));
        // No staging folder is left behind.
        let leftovers = fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name().to_string_lossy().starts_with(".bundled-") && e.path().is_dir()
            })
            .count();
        assert_eq!(leftovers, 0);
        assert!(install_bundled(&root, "nope").is_err());
        // Every compiled script ships: a missing one would only fail when a pane opens.
        let dir =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/documents/providers/spreadsheet");
        for script in fs::read_dir(dir).unwrap().filter_map(|e| e.ok()) {
            let name = script.file_name().to_string_lossy().to_string();
            if name.ends_with(".js") {
                assert!(
                    files("spreadsheet")
                        .unwrap()
                        .iter()
                        .any(|(f, _)| *f == name),
                    "{name}"
                );
            }
        }
        let _ = fs::remove_dir_all(&root);
    }
}
