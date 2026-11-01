//! Approved provider bundles live in Cairngorm's private data folder. Only bundles listed in
//! `approved.json` whose whole-bundle hash still matches are loaded: a folder that appears or
//! changes there by other means never runs.
use super::{
    bundle::{self, Bundle},
    manifest::{self, Manifest, MANIFEST_FILE},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const INDEX: &str = "approved.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub manifest: Manifest,
    /// Hash of every reviewed file; installing anything else is refused.
    pub approval_hash: String,
    pub files: usize,
    pub bytes: u64,
    pub replaces: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub id: String,
    pub manifest: Option<Manifest>,
    pub error: Option<String>,
}

/// Verified listing per data folder; cleared whenever this module changes the folder.
static CACHE: Mutex<Option<(PathBuf, Vec<Installed>)>> = Mutex::new(None);

fn checked(source: &Path) -> Result<(Manifest, Bundle), String> {
    let bundle = bundle::read(source)?;
    let text = bundle
        .file(MANIFEST_FILE)
        .ok_or_else(|| format!("This folder has no {MANIFEST_FILE}."))?;
    let manifest = manifest::parse(text)?;
    if bundle.file(&manifest.entry).is_none() {
        return Err(format!("The entry page \"{}\" is missing.", manifest.entry));
    }
    for template in manifest
        .file_types
        .iter()
        .filter_map(|t| t.template.as_ref())
    {
        if bundle.file(template).is_none() {
            return Err(format!("The template \"{template}\" is missing."));
        }
    }
    Ok((manifest, bundle))
}

pub fn inspect(root: &Path, source: &Path) -> Result<Inspection, String> {
    let (manifest, bundle) = checked(source)?;
    let replaces = list(root)
        .into_iter()
        .find(|p| p.id == manifest.id)
        .and_then(|p| p.manifest.map(|m| m.version));
    Ok(Inspection {
        files: bundle.files.len(),
        bytes: bundle.bytes(),
        approval_hash: bundle.hash,
        manifest,
        replaces,
    })
}

/// Copies the reviewed bundle from the same bytes that were hashed.
pub fn install(root: &Path, source: &Path, approved_hash: &str) -> Result<Manifest, String> {
    let (manifest, bundle) = checked(source)?;
    if bundle.hash != approved_hash {
        return Err("The provider changed after it was reviewed. Review it again.".into());
    }
    let id = manifest.id.clone();
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4().simple()));
    if let Err(error) = bundle.write_to(&staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let target = root.join(&id);
    let previous = root.join(format!(".old-{}", uuid::Uuid::new_v4().simple()));
    if target.exists() {
        fs::rename(&target, &previous).map_err(|e| {
            let _ = fs::remove_dir_all(&staging);
            format!("Could not replace the installed provider: {e}")
        })?;
    }
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::rename(&previous, &target);
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Could not install the provider: {error}"));
    }
    let _ = fs::remove_dir_all(&previous);
    let mut index = read_index(root);
    index.retain(|(entry, _)| entry != &id);
    index.push((id, approved_hash.to_string()));
    write_index(root, &index)?;
    Ok(manifest)
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let mut index = read_index(root);
    let before = index.len();
    index.retain(|(entry, _)| entry != id);
    if index.len() == before {
        return Err("That provider is not installed.".into());
    }
    // Revoke approval first: a folder that fails to delete can no longer load.
    write_index(root, &index)?;
    if manifest::valid_segment(id) {
        let _ = fs::remove_dir_all(root.join(id));
    }
    Ok(())
}

/// Approved providers, each re-verified once per change; tampered ones report an error.
pub fn list(root: &Path) -> Vec<Installed> {
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((cached_root, listed)) = cache.as_ref() {
        if cached_root == root {
            return listed.clone();
        }
    }
    let listed: Vec<Installed> = read_index(root)
        .into_iter()
        .map(|(id, hash)| {
            let verified = checked(&root.join(&id)).and_then(|(manifest, bundle)| {
                if bundle.hash != hash || manifest.id != id {
                    return Err(
                        "The installed files changed after approval. Reinstall the provider."
                            .into(),
                    );
                }
                Ok(manifest)
            });
            match verified {
                Ok(manifest) => Installed {
                    id,
                    manifest: Some(manifest),
                    error: None,
                },
                Err(error) => Installed {
                    id,
                    manifest: None,
                    error: Some(error),
                },
            }
        })
        .collect();
    *cache = Some((root.to_path_buf(), listed.clone()));
    listed
}

pub fn approved(root: &Path, id: &str) -> Option<Manifest> {
    list(root).into_iter().find(|p| p.id == id)?.manifest
}

/// The approval hash recorded for `id`, verified or not (a changed folder still has one).
pub fn recorded_hash(root: &Path, id: &str) -> Option<String> {
    read_index(root)
        .into_iter()
        .find(|(entry, _)| entry == id)
        .map(|(_, hash)| hash)
}

/// Forgets the verified listing (after this module or a test changes the folder).
pub fn invalidate() {
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn read_index(root: &Path) -> Vec<(String, String)> {
    let Ok(text) = fs::read_to_string(root.join(INDEX)) else {
        return Vec::new();
    };
    let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    value["providers"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|p| {
                    Some((
                        p["id"].as_str()?.to_string(),
                        p["approvalHash"].as_str()?.to_string(),
                    ))
                })
                .filter(|(id, _)| manifest::valid_segment(id))
                .collect()
        })
        .unwrap_or_default()
}

fn write_index(root: &Path, index: &[(String, String)]) -> Result<(), String> {
    invalidate();
    let providers: Vec<Value> = index
        .iter()
        .map(|(id, hash)| json!({ "id": id, "approvalHash": hash }))
        .collect();
    let text = serde_json::to_string_pretty(&json!({ "providers": providers }))
        .map_err(|e| e.to_string())?;
    let tmp = root.join(format!("{INDEX}.tmp"));
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    let result = fs::rename(&tmp, root.join(INDEX)).map_err(|e| e.to_string());
    invalidate();
    result
}

#[cfg(test)]
#[path = "../../../tests/native/document_install.rs"]
pub mod tests;
