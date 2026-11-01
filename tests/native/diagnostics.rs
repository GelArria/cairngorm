use super::*;

#[test]
fn private_diagnostics_reject_relative_locations() {
    assert!(private_log_dir(Path::new(".")).is_err());
}

#[test]
fn private_diagnostics_use_user_storage_and_never_replace_existing_files() {
    let root = std::env::temp_dir().join(format!("cairngorm-diagnostics-{}", uuid::Uuid::new_v4()));
    let dir = private_log_dir(&root).unwrap();
    assert_eq!(dir, root.join("Cairngorm/logs"));
    let file = dir.join("hang-test.json");
    write_private_json(&file, b"private diagnostic").unwrap();
    assert!(write_private_json(&file, b"replacement").is_err());
    assert_eq!(fs::read(&file).unwrap(), b"private diagnostic");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn private_diagnostics_reject_non_directory_targets() {
    let root = std::env::temp_dir().join(format!("cairngorm-diagnostics-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("Cairngorm"), b"existing file").unwrap();
    assert!(private_log_dir(&root).is_err());
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn private_diagnostics_reject_linked_directories() {
    let root = std::env::temp_dir().join(format!("cairngorm-diagnostics-{}", uuid::Uuid::new_v4()));
    let outside = root.join("outside");
    fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("Cairngorm")).unwrap();
    assert!(private_log_dir(&root).is_err());
    assert!(!outside.join("logs").exists());
    fs::remove_dir_all(root).unwrap();
}
