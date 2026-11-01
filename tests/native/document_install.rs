use super::*;
use std::fs;
use std::path::PathBuf;

pub struct Scratch(pub PathBuf);
impl Scratch {
    pub fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("cairngorm-docs-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub fn write_bundle(dir: &Path, id: &str, version: &str) {
    fs::create_dir_all(dir.join("assets")).unwrap();
    let manifest = serde_json::json!({
        "protocol": manifest::PROTOCOL,
        "id": id,
        "name": "Sample viewer",
        "version": version,
        "entry": "index.html",
        "fileTypes": [{ "label": "Sample", "extensions": ["sample"] }],
        "capabilities": ["view"]
    });
    fs::write(dir.join(MANIFEST_FILE), manifest.to_string()).unwrap();
    fs::write(
        dir.join("index.html"),
        "<!doctype html><script type=module src=main.js></script>",
    )
    .unwrap();
    fs::write(dir.join("main.js"), "export {}").unwrap();
    fs::write(dir.join("assets/style.css"), "body{}").unwrap();
    fs::create_dir_all(dir.join(".git")).unwrap();
    fs::write(dir.join(".git/config"), "skipped").unwrap();
}

#[test]
fn installs_only_the_reviewed_bundle_and_lists_it() {
    let scratch = Scratch::new();
    let (source, root) = (scratch.0.join("source"), scratch.0.join("installed"));
    write_bundle(&source, "com.example.sample", "1.0.0");
    let reviewed = inspect(&root, &source).unwrap();
    assert_eq!(reviewed.files, 4);
    assert_eq!(reviewed.replaces, None);
    install(&root, &source, &reviewed.approval_hash).unwrap();
    assert!(root.join("com.example.sample/assets/style.css").is_file());
    assert!(!root.join("com.example.sample/.git").exists());
    let listed = list(&root);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].manifest.as_ref().unwrap().version, "1.0.0");

    write_bundle(&source, "com.example.sample", "1.1.0");
    assert!(install(&root, &source, &reviewed.approval_hash)
        .unwrap_err()
        .contains("changed"));
    let update = inspect(&root, &source).unwrap();
    assert_eq!(update.replaces.as_deref(), Some("1.0.0"));
    install(&root, &source, &update.approval_hash).unwrap();
    assert_eq!(
        approved(&root, "com.example.sample").unwrap().version,
        "1.1.0"
    );
    assert_eq!(list(&root).len(), 1);
}

#[test]
fn tampered_or_unapproved_folders_never_load() {
    let scratch = Scratch::new();
    let (source, root) = (scratch.0.join("source"), scratch.0.join("installed"));
    write_bundle(&source, "com.example.sample", "1.0.0");
    let reviewed = inspect(&root, &source).unwrap();
    install(&root, &source, &reviewed.approval_hash).unwrap();
    write_bundle(
        &root.join("com.example.dropped"),
        "com.example.dropped",
        "1.0.0",
    );
    assert!(approved(&root, "com.example.dropped").is_none());
    // Changing code, not only the manifest, revokes the approval (checked on the next listing).
    fs::write(root.join("com.example.sample/main.js"), "steal()").unwrap();
    invalidate();
    assert!(approved(&root, "com.example.sample").is_none());
    assert!(list(&root)[0].error.as_ref().unwrap().contains("changed"));
}

#[test]
fn code_changed_after_review_is_not_installed() {
    let scratch = Scratch::new();
    let (source, root) = (scratch.0.join("source"), scratch.0.join("installed"));
    write_bundle(&source, "com.example.reviewed", "1.0.0");
    let reviewed = inspect(&root, &source).unwrap();
    fs::write(source.join("main.js"), "steal()").unwrap();
    let error = install(&root, &source, &reviewed.approval_hash).unwrap_err();
    assert!(error.contains("changed"), "{error}");
    assert!(!root.join("com.example.reviewed").exists());
    assert!(list(&root).iter().all(|p| p.id != "com.example.reviewed"));
}

#[test]
fn remove_revokes_approval_and_deletes_files() {
    let scratch = Scratch::new();
    let (source, root) = (scratch.0.join("source"), scratch.0.join("installed"));
    write_bundle(&source, "com.example.sample", "1.0.0");
    let reviewed = inspect(&root, &source).unwrap();
    install(&root, &source, &reviewed.approval_hash).unwrap();
    remove(&root, "com.example.sample").unwrap();
    assert!(list(&root).is_empty());
    assert!(!root.join("com.example.sample").exists());
    assert!(remove(&root, "com.example.sample").is_err());
}

#[test]
fn refuses_missing_entries_bad_names_and_oversized_bundles() {
    let scratch = Scratch::new();
    let root = scratch.0.join("installed");
    let source = scratch.0.join("missing-entry");
    write_bundle(&source, "com.example.sample", "1.0.0");
    fs::remove_file(source.join("index.html")).unwrap();
    assert!(inspect(&root, &source).unwrap_err().contains("entry"));

    let crowded = scratch.0.join("crowded");
    write_bundle(&crowded, "com.example.crowded", "1.0.0");
    for i in 0..520 {
        fs::write(crowded.join(format!("f{i}.txt")), "x").unwrap();
    }
    assert!(inspect(&root, &crowded).unwrap_err().contains("too large"));
    assert!(inspect(&root, &scratch.0.join("nowhere")).is_err());
}

#[cfg(windows)]
#[test]
fn refuses_links_inside_a_bundle() {
    let scratch = Scratch::new();
    let source = scratch.0.join("linked");
    write_bundle(&source, "com.example.linked", "1.0.0");
    let outside = scratch.0.join("outside");
    fs::create_dir_all(&outside).unwrap();
    let status = std::process::Command::new("cmd")
        .args(["/c", "mklink", "/J"])
        .arg(source.join("escape"))
        .arg(&outside)
        .output()
        .unwrap();
    assert!(status.status.success());
    assert!(inspect(&scratch.0.join("installed"), &source)
        .unwrap_err()
        .contains("link"));
}
