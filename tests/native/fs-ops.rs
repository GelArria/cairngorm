use super::*;

fn scratch(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("cairngorm-fsops-{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&p).unwrap();
    p
}
fn s(p: PathBuf) -> String {
    p.to_string_lossy().into_owned()
}

#[test]
fn create_never_overwrites() {
    let d = scratch("create");
    tauri::async_runtime::block_on(async {
        let f = d.join("a.txt");
        fs_create_file(s(f.clone())).await.unwrap();
        fs::write(&f, "keep").unwrap();
        assert!(fs_create_file(s(f.clone()))
            .await
            .unwrap_err()
            .contains("already exists"));
        assert_eq!(fs::read_to_string(&f).unwrap(), "keep");
        fs_create_dir(s(d.join("sub/deep"))).await.unwrap();
        assert!(d.join("sub/deep").is_dir());
    });
    fs::remove_dir_all(d).unwrap();
}

#[test]
fn rejects_relative_and_parent_paths() {
    let d = scratch("dots");
    tauri::async_runtime::block_on(async {
        assert!(fs_delete("relative/file".into()).await.is_err());
        assert!(fs_create_file("..\\x".into()).await.is_err());
        assert!(fs_reveal("relative/file".into()).await.is_err());
        assert!(fs_open_default("relative/file".into()).await.is_err());
        assert!(fs_reveal(s(d.join("missing")))
            .await
            .unwrap_err()
            .contains("Path no longer exists"));
        assert!(fs_open_default(s(d.join("missing")))
            .await
            .unwrap_err()
            .contains("Path no longer exists"));
        assert!(fs_delete(format!("{}/sub/../..", d.to_string_lossy()))
            .await
            .is_err());
    });
    fs::remove_dir_all(d).unwrap();
}

#[test]
fn copy_is_recursive_and_refuses_self_nesting() {
    let d = scratch("copy");
    fs::create_dir_all(d.join("src/inner")).unwrap();
    fs::write(d.join("src/inner/x.txt"), "hi").unwrap();
    tauri::async_runtime::block_on(async {
        fs_copy(s(d.join("src")), s(d.join("dup"))).await.unwrap();
        assert_eq!(fs::read_to_string(d.join("dup/inner/x.txt")).unwrap(), "hi");
        assert!(fs_copy(s(d.join("src")), s(d.join("src/inside")))
            .await
            .is_err());
        assert!(fs_copy(s(d.join("src")), s(d.join("dup"))).await.is_err());
    });
    fs::remove_dir_all(d).unwrap();
}

#[test]
fn rename_moves_and_guards_destination() {
    let d = scratch("rename");
    fs::write(d.join("a.txt"), "1").unwrap();
    fs::write(d.join("b.txt"), "2").unwrap();
    tauri::async_runtime::block_on(async {
        assert!(fs_rename(s(d.join("a.txt")), s(d.join("b.txt")))
            .await
            .is_err());
        fs_rename(s(d.join("a.txt")), s(d.join("c.txt")))
            .await
            .unwrap();
        assert!(!d.join("a.txt").exists() && d.join("c.txt").exists());
        fs::create_dir_all(d.join("dir")).unwrap();
        assert!(fs_rename(s(d.join("dir")), s(d.join("dir/child")))
            .await
            .is_err());
    });
    fs::remove_dir_all(d).unwrap();
}

#[cfg(windows)]
#[test]
fn case_only_rename_is_allowed() {
    let d = scratch("case");
    fs::write(d.join("a.txt"), "1").unwrap();
    tauri::async_runtime::block_on(fs_rename(s(d.join("a.txt")), s(d.join("A.txt")))).unwrap();
    let names: Vec<String> = fs::read_dir(&d)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec!["A.txt".to_string()]);
    fs::remove_dir_all(d).unwrap();
}

#[test]
fn delete_removes_files_and_folders() {
    let d = scratch("delete");
    fs::create_dir_all(d.join("t/u")).unwrap();
    fs::write(d.join("t/u/f"), "x").unwrap();
    tauri::async_runtime::block_on(fs_delete(s(d.join("t")))).unwrap();
    assert!(!d.join("t").exists());
    fs::remove_dir_all(d).unwrap();
}

#[test]
fn scripts_and_executables_are_not_launched() {
    let d = scratch("launch");
    let bat = d.join("build.BAT");
    fs::write(&bat, "echo hi").unwrap();
    assert!(tauri::async_runtime::block_on(fs_open_default(s(bat)))
        .unwrap_err()
        .contains("Won't launch"));
    assert!(!is_launchable(&d));
    fs::remove_dir_all(d).unwrap();
}
