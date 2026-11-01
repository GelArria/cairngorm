// cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib git_commit_options
use crate::{git, git_ops};
use std::{fs, path::PathBuf};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn commit_modes_and_failed_hook_report_real_index() {
    let dir =
        Scratch(std::env::temp_dir().join(format!("cairngorm-commit-{}", uuid::Uuid::new_v4())));
    fs::create_dir_all(&dir.0).unwrap();
    let root = dir.0.to_string_lossy().into_owned();
    let run = |args: &[&str]| git::git(&dir.0, args).unwrap();
    tauri::async_runtime::block_on(async {
        assert!(git::git_init(root.clone()).await.error.is_none());
        run(&["config", "user.name", "Test"]);
        run(&["config", "user.email", "test@example.invalid"]);
        run(&["config", "commit.gpgsign", "false"]);
        run(&["config", "core.hooksPath", ".git/hooks"]);
        fs::write(dir.0.join("tracked.txt"), "before\n").unwrap();
        run(&["add", "tracked.txt"]);
        assert!(git::git_commit(root.clone(), "initial".into(), None, None)
            .await
            .error
            .is_none());
        fs::write(dir.0.join("tracked.txt"), "after\n").unwrap();
        fs::write(dir.0.join("new.txt"), "new\n").unwrap();
        let tracked =
            git::git_commit(root.clone(), "tracked".into(), Some("tracked".into()), None).await;
        assert!(tracked.error.is_none());
        assert_eq!(tracked.files.len(), 1);
        assert_eq!(tracked.files[0].code, "??");
        let hook = dir.0.join(".git/hooks/pre-commit");
        fs::write(&hook, "#!/bin/sh\necho hook-rejected >&2\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let failed = git::git_commit(root.clone(), "all".into(), Some("all".into()), None).await;
        assert!(failed.error.unwrap().contains("hook-rejected"));
        assert_eq!(failed.files.len(), 1);
        assert_eq!(failed.files[0].path, "new.txt");
        assert_eq!(failed.files[0].code, "A "); // add succeeded even though commit failed
        fs::remove_file(hook).unwrap();
        assert!(
            git::git_commit(root.clone(), "all".into(), Some("all".into()), None)
                .await
                .files
                .is_empty()
        );
        let status = git_ops::git_remote_status(root.clone()).await.unwrap();
        assert!(!status.upstream && status.remote.is_none() && status.ahead > 0);
        assert!(git_ops::git_sync(root, "invalid".into(), None)
            .await
            .unwrap_err()
            .contains("Unknown sync action"));
    });
}
