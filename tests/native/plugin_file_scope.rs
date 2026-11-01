use super::*;
use std::fs::{self, File};

#[path = "plugin_file_scope_fixture.rs"]
mod fixture;
use fixture::{directory_link, Scratch};

#[cfg(windows)]
#[test]
fn project_reads_preserve_bytes_and_enforce_snapshot_limits() {
    let scratch = Scratch::new();
    let scope = ProjectScope::new(&scratch.root()).unwrap();
    let file = scope.open_read("Unicode-校验/notes.txt").unwrap();
    let snapshot = file.snapshot(15).unwrap();
    assert_eq!(snapshot.bytes, b"original\r\nbytes");
    assert_eq!(
        snapshot.path,
        scratch
            .root()
            .join("Unicode-校验/notes.txt")
            .canonicalize()
            .unwrap()
    );
    let error = scope
        .open_read("Unicode-校验/notes.txt")
        .unwrap()
        .snapshot(14)
        .err()
        .unwrap();
    assert_eq!(error.code, "file-too-large");
    assert!(!error.message.is_empty());
    assert_eq!(
        fs::read(scratch.root().join("Unicode-校验/notes.txt")).unwrap(),
        b"original\r\nbytes"
    );
    let large = scratch.root().join("large.bin");
    File::create(&large)
        .unwrap()
        .set_len((MAX_SNAPSHOT_BYTES + 1) as u64)
        .unwrap();
    assert_eq!(
        scope
            .open_read("large.bin")
            .unwrap()
            .snapshot(usize::MAX)
            .err()
            .unwrap()
            .code,
        "file-too-large"
    );
}

#[cfg(windows)]
#[test]
fn traversal_absolute_paths_and_sibling_prefixes_need_separate_authorization() {
    let scratch = Scratch::new();
    let scope = ProjectScope::new(&scratch.root()).unwrap();
    for path in [
        "../outside/secret.txt".to_string(),
        scratch
            .0
            .join("outside/secret.txt")
            .to_string_lossy()
            .into_owned(),
        scratch
            .0
            .join("project with spaces-other/sibling.txt")
            .to_string_lossy()
            .into_owned(),
    ] {
        assert_eq!(
            scope.open_read(&path).err().unwrap().code,
            "not-authorized",
            "{path}"
        );
    }
    assert!(scope
        .open_read("Unicode-校验/../Unicode-校验/notes.txt")
        .is_ok());
    // Agents pass plain absolute paths (any drive-letter case) for files inside the project.
    let root = scope.root_path().to_string_lossy().into_owned();
    let inside = format!(
        "{}\\Unicode-校验\\notes.txt",
        root.strip_prefix(r"\\?\").unwrap_or(&root)
    );
    assert!(scope.open_read(&inside).is_ok(), "{inside}");
    let lower = format!("{}{}", inside[..1].to_ascii_lowercase(), &inside[1..]);
    assert!(scope.open_read(&lower).is_ok(), "{lower}");
    assert!(scope
        .resolve(&lower)
        .unwrap()
        .starts_with(scope.root_path()));
    assert!(scope.open_read("Unicode-校验").is_err());
    assert!(ProjectScope::new(Path::new("relative-root")).is_err());
    for path in ["", "notes\0.txt", "notes\n.txt", "notes\r.txt"] {
        assert_eq!(scope.open_read(path).err().unwrap().code, "invalid-path");
    }
}

#[cfg(windows)]
#[test]
fn windows_devices_unc_drive_relative_paths_and_alternate_streams_are_rejected() {
    let scratch = Scratch::new();
    let scope = ProjectScope::new(&scratch.root()).unwrap();
    for path in [
        r"\\server\share\secret.txt",
        r"\\.\pipe\cairngorm",
        r"\\?\GLOBALROOT\Device\HarddiskVolume1\file",
        r"C:notes.txt",
        r"\notes.txt",
        "NUL",
        "CON.txt",
        "CON .txt",
        "COM1",
        "LPT¹.txt",
        "notes.txt:secret",
        "notes.txt.",
        "notes.txt ",
    ] {
        assert_eq!(
            scope.open_read(path).err().unwrap().code,
            "invalid-path",
            "{path}"
        );
    }
}

#[cfg(windows)]
#[test]
fn local_and_remote_reparse_points_are_rejected_without_following_targets() {
    let scratch = Scratch::new();
    let scope = ProjectScope::new(&scratch.root()).unwrap();
    let link = scratch.root().join("alias");
    directory_link(&scratch.root().join("Unicode-校验"), &link);
    assert!(scope
        .open_read("alias/notes.txt")
        .err()
        .unwrap()
        .message
        .contains("Reparse-point"));
    fs::remove_dir(&link).unwrap();
    // This nonexistent UNC target is never resolved or contacted: only the link itself is opened.
    directory_link(
        Path::new(r"\\cairngorm-must-not-contact.invalid\share"),
        &link,
    );
    assert!(scope
        .open_read("alias/secret.txt")
        .err()
        .unwrap()
        .message
        .contains("Reparse-point"));
    assert!(ProjectScope::new(&link)
        .err()
        .unwrap()
        .message
        .contains("Reparse-point"));
}

#[cfg(windows)]
#[test]
fn opened_windows_files_cannot_be_replaced_or_modified_during_snapshot_creation() {
    let scratch = Scratch::new();
    let scope = ProjectScope::new(&scratch.root()).unwrap();
    let path = scratch.root().join("Unicode-校验/notes.txt");
    let authorized = scope.open_read("Unicode-校验/notes.txt").unwrap();
    assert!(fs::write(&path, b"replacement").is_err());
    assert!(fs::rename(&path, path.with_extension("moved")).is_err());
    assert_eq!(
        authorized.snapshot(1024).unwrap().bytes,
        b"original\r\nbytes"
    );
    fs::write(&path, b"allowed after snapshot").unwrap();
}

#[cfg(windows)]
#[test]
fn pinned_parent_cannot_be_redirected_between_resolution_and_leaf_open() {
    let scratch = Scratch::new();
    let scope = ProjectScope::new(&scratch.root()).unwrap();
    let parent = scratch.root().join("Unicode-校验");
    let moved = scratch.root().join("moved");
    let target = scratch.0.join("outside");
    file_handles::before_leaf(move || {
        use std::os::windows::fs::OpenOptionsExt;
        let write = fs::OpenOptions::new()
            .write(true)
            .share_mode(7)
            .custom_flags(0x0200_0000)
            .open(&parent);
        assert_eq!(
            write.err().unwrap().raw_os_error(),
            Some(32),
            "deny directory writes that could retarget a reparse point"
        );
        assert!(
            fs::rename(&parent, &moved).is_err(),
            "the opened parent must deny rename"
        );
        assert!(std::os::windows::fs::symlink_dir(&target, &parent).is_err());
    });
    assert_eq!(
        scope
            .open_read("Unicode-校验/notes.txt")
            .unwrap()
            .snapshot(1024)
            .unwrap()
            .bytes,
        b"original\r\nbytes"
    );
    assert!(fs::rename(scratch.root(), scratch.0.join("moved-root")).is_err());
}

#[cfg(not(windows))]
#[test]
fn unsupported_platforms_fail_closed_before_filesystem_access() {
    let scratch = Scratch::new();
    assert!(ProjectScope::new(&scratch.root())
        .err()
        .unwrap()
        .message
        .contains("not yet available"));
}
