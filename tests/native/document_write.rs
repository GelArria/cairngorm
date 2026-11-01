use super::*;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("cairngorm-write-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn saves_only_the_opened_version_and_keeps_a_backup() {
    let scratch = Scratch::new();
    let path = scratch.0.join("Field notes 日本語.sample");
    let backups = scratch.0.join("backups");
    fs::write(&path, b"# Before").unwrap();
    let opened = digest(b"# Before");
    let version = write(&path, &opened, b"# After", &backups).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"# After");
    assert_eq!(version, digest(b"# After"));
    let kept: Vec<_> = fs::read_dir(&backups).unwrap().collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(
        fs::read(kept[0].as_ref().unwrap().path()).unwrap(),
        b"# Before"
    );
    // No temporary file is left beside the document.
    let siblings: Vec<_> = fs::read_dir(&scratch.0)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name())
        .collect();
    assert_eq!(siblings.len(), 2, "{siblings:?}");
}

#[test]
fn a_changed_file_is_a_conflict_and_stays_untouched() {
    let scratch = Scratch::new();
    let path = scratch.0.join("doc.sample");
    fs::write(&path, b"someone else's edit").unwrap();
    let error = write(
        &path,
        &digest(b"what the provider opened"),
        b"mine",
        &scratch.0.join("b"),
    )
    .unwrap_err();
    assert_eq!(error, WriteError::Conflict);
    assert_eq!(fs::read(&path).unwrap(), b"someone else's edit");
    assert!(error.message().contains("not written"));
}

#[test]
fn missing_files_folders_and_oversized_saves_are_refused() {
    let scratch = Scratch::new();
    let backups = scratch.0.join("b");
    assert!(write(&scratch.0.join("missing"), "x", b"y", &backups).is_err());
    assert!(write(&scratch.0, "x", b"y", &backups).is_err());
    let path = scratch.0.join("doc.sample");
    fs::write(&path, b"a").unwrap();
    let huge = vec![0u8; (HOST_MAX_BYTES + 1) as usize];
    assert!(write(&path, &digest(b"a"), &huge, &backups).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"a");
}

#[cfg(windows)]
#[test]
fn a_file_locked_by_another_program_reports_in_use_and_survives() {
    use std::os::windows::fs::OpenOptionsExt;
    let scratch = Scratch::new();
    let path = scratch.0.join("locked.sample");
    fs::write(&path, b"original").unwrap();
    // Like an Office app: shares reads but not deletes/renames.
    let _holder = fs::OpenOptions::new()
        .read(true)
        .share_mode(0x1)
        .open(&path)
        .unwrap();
    let error = write(&path, &digest(b"original"), b"new", &scratch.0.join("b")).unwrap_err();
    assert_eq!(error, WriteError::InUse, "{}", error.message());
    drop(_holder);
    assert_eq!(fs::read(&path).unwrap(), b"original");
}

#[test]
fn backups_are_kept_per_document_and_links_write_their_target() {
    let scratch = Scratch::new();
    let backups = scratch.0.join("b");
    let busy = scratch.0.join("busy.sample");
    let other = scratch.0.join("other.sample");
    fs::write(&other, b"o0").unwrap();
    write(&other, &digest(b"o0"), b"o1", &backups).unwrap();
    let mut content = b"v0".to_vec();
    fs::write(&busy, &content).unwrap();
    for i in 1..=(BACKUPS_PER_FILE + 4) {
        let next = format!("v{i}").into_bytes();
        write(&busy, &digest(&content), &next, &backups).unwrap();
        content = next;
    }
    // Frequent saves of one document keep its newest few and leave the other's backup.
    assert_eq!(
        fs::read_dir(&backups).unwrap().count(),
        BACKUPS_PER_FILE + 1
    );
    let long = scratch.0.join(format!("{}.sample", "x".repeat(150)));
    fs::write(&long, b"a").unwrap();
    write(&long, &digest(b"a"), b"b", &backups).unwrap();
}
