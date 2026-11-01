// Real Git repos and a bare local remote: never modifies the developer's repo.
use crate::{git, git_actions, git_ops, git_summary};
use std::{fs, path::PathBuf};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn branches_remotes_history_and_summary_modes() {
    let dir = Scratch(
        std::env::temp_dir().join(format!("cairngorm-git-actions-{}", uuid::Uuid::new_v4())),
    );
    let work = dir.0.join("work");
    let remote = dir.0.join("remote.git");
    fs::create_dir_all(&work).unwrap();
    fs::create_dir_all(&remote).unwrap();
    git::git(&remote, &["init", "--bare"]).unwrap();
    let root = work.to_string_lossy().to_string();
    let run = |args: &[&str]| git::git(&work, args).unwrap();
    tauri::async_runtime::block_on(async {
        assert!(git::git_init(root.clone()).await.error.is_none());
        run(&["config", "user.name", "Test"]);
        run(&["config", "user.email", "test@example.invalid"]);
        run(&["config", "commit.gpgsign", "false"]);
        run(&["config", "core.hooksPath", ".git/hooks"]);
        run(&["config", "core.autocrlf", "false"]);
        run(&["switch", "-c", "main"]);
        fs::write(work.join("tracked.txt"), "base\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "base"]);
        run(&["remote", "add", "origin", &remote.to_string_lossy()]);
        let status = git_ops::git_remote_status(root.clone()).await.unwrap();
        assert!(
            !status.upstream && status.ahead == 1 && status.remote.as_deref() == Some("origin")
        );
        git_ops::git_sync(root.clone(), "publish".into(), None)
            .await
            .unwrap();
        git_actions::git_switch(root.clone(), "feature".into(), true)
            .await
            .unwrap();
        fs::write(work.join("feature.txt"), "feature\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "feature"]);
        let hash = run(&["rev-parse", "HEAD"]).trim().to_string();
        git_actions::git_switch(root.clone(), "main".into(), false)
            .await
            .unwrap();
        let branches = git_actions::git_branches(root.clone()).await.unwrap();
        assert!(branches.contains(&"feature".into()) && branches.contains(&"origin/main".into()));
        assert!(
            git_actions::git_switch(root.clone(), "--discard-changes".into(), false)
                .await
                .is_err()
        );
        git_actions::git_commit_action(root.clone(), "cherry-pick".into(), Some(hash))
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(work.join("feature.txt")).unwrap(),
            "feature\n"
        );
        let picked = run(&["rev-parse", "HEAD"]).trim().to_string();
        git_actions::git_commit_action(root.clone(), "revert".into(), Some(picked))
            .await
            .unwrap();
        assert!(!work.join("feature.txt").exists());
        let status = git_ops::git_remote_status(root.clone()).await.unwrap();
        assert!(status.upstream && status.ahead == 2 && status.behind == 0);
        let backup = dir.0.join("backup.git");
        fs::create_dir_all(&backup).unwrap();
        git::git(&backup, &["init", "--bare"]).unwrap();
        run(&["remote", "add", "backup", &backup.to_string_lossy()]);
        run(&["config", "branch.main.pushRemote", "backup"]);
        git_ops::git_sync(root.clone(), "push-upstream".into(), Some("origin".into()))
            .await
            .unwrap();
        assert!(git::git(&backup, &["rev-parse", "--verify", "refs/heads/main"]).is_err());
        assert_eq!(
            git::git(&remote, &["rev-parse", "refs/heads/main"])
                .unwrap()
                .trim(),
            run(&["rev-parse", "HEAD"]).trim()
        );
        run(&["config", "--unset", "branch.main.pushRemote"]);
        git_ops::git_sync(root.clone(), "fetch".into(), None)
            .await
            .unwrap();
        git_ops::git_sync(root.clone(), "pull".into(), None)
            .await
            .unwrap();
        let status = git_ops::git_remote_status(root.clone()).await.unwrap();
        assert!(status.upstream && status.ahead == 0 && status.behind == 0);
        assert_eq!(status.remote.as_deref(), Some("origin"));
        // A remote-only branch is checked out as a local tracking branch.
        run(&["push", "origin", "feature:remote-feature"]);
        git_ops::git_sync(root.clone(), "fetch".into(), None)
            .await
            .unwrap();
        git_actions::git_switch(root.clone(), "origin/remote-feature".into(), false)
            .await
            .unwrap();
        assert_eq!(run(&["branch", "--show-current"]).trim(), "remote-feature");
        assert_eq!(
            run(&["rev-parse", "--abbrev-ref", "@{upstream}"]).trim(),
            "origin/remote-feature"
        );
        git_actions::git_switch(root.clone(), "main".into(), false)
            .await
            .unwrap();
        fs::write(work.join("tracked.txt"), "staged-only\n").unwrap();
        run(&["add", "tracked.txt"]);
        fs::write(work.join("tracked.txt"), "working-only\n").unwrap();
        fs::write(work.join("untracked.txt"), "untracked-body\n").unwrap();
        let staged = git_summary::context(&work, "staged").unwrap();
        assert!(staged.contains("staged-only") && !staged.contains("working-only"));
        let tracked = git_summary::context(&work, "tracked").unwrap();
        assert!(tracked.contains("working-only") && !tracked.contains("untracked-body"));
        let all = git_summary::context(&work, "all").unwrap();
        assert!(all.contains("working-only") && all.contains("untracked-body"));
        assert!(git_summary::context(&work, "invalid").is_err());
        assert!(git_actions::git_commit_action(
            root.clone(),
            "cherry-pick".into(),
            Some("HEAD".into())
        )
        .await
        .is_err());
        assert!(git_actions::git_commit_action(
            root.clone(),
            "cherry-pick".into(),
            Some("abcd".into())
        )
        .await
        .unwrap_err()
        .contains("stash"));
        fs::write(work.join("untracked.txt"), "ü".repeat(30_000)).unwrap();
        assert!(git_summary::context(&work, "all").unwrap().len() <= 24_000);
        // Produce a real conflict, then exercise both recovery paths.
        run(&["reset", "--hard", "HEAD"]);
        fs::remove_file(work.join("untracked.txt")).unwrap();
        git_actions::git_switch(root.clone(), "conflict".into(), true)
            .await
            .unwrap();
        fs::write(work.join("tracked.txt"), "feature-version\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "conflict source"]);
        let conflict = run(&["rev-parse", "HEAD"]).trim().to_string();
        git_actions::git_switch(root.clone(), "main".into(), false)
            .await
            .unwrap();
        fs::write(work.join("tracked.txt"), "main-version\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "conflict target"]);
        assert!(git_actions::git_commit_action(
            root.clone(),
            "cherry-pick".into(),
            Some(conflict.clone())
        )
        .await
        .is_err());
        git_actions::git_commit_action(root.clone(), "cherry-pick-abort".into(), None)
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(work.join("tracked.txt")).unwrap(),
            "main-version\n"
        );
        assert!(
            git_actions::git_commit_action(root.clone(), "cherry-pick".into(), Some(conflict))
                .await
                .is_err()
        );
        fs::write(work.join("tracked.txt"), "resolved\n").unwrap();
        run(&["add", "."]);
        git_actions::git_commit_action(root.clone(), "cherry-pick-continue".into(), None)
            .await
            .unwrap();
        assert!(run(&["status", "--porcelain"]).is_empty());
    });
}
