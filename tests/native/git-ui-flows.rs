// Local scratch repos only: commit options, lease rejection, rebase, paged topology.
use crate::{git, git_commit_details, git_history, git_ops};
use std::{fs, path::PathBuf};
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn init(path: &std::path::Path) {
    fs::create_dir_all(path).unwrap();
    let commands: &[&[&str]] = &[
        &["init", "-q"],
        &["config", "user.name", "Test"],
        &["config", "user.email", "test@example.invalid"],
        &["config", "commit.gpgsign", "false"],
        &["config", "core.hooksPath", ".git/hooks"],
        &["config", "core.autocrlf", "false"],
    ];
    for args in commands {
        git::git(path, args).unwrap();
    }
}
#[test]
fn git_options_amend_signoff_and_explicit_hook_bypass() {
    let dir = Scratch(
        std::env::temp_dir().join(format!("cairngorm-git-options-{}", uuid::Uuid::new_v4())),
    );
    init(&dir.0);
    let root = dir.0.to_string_lossy().into_owned();
    let run = |args: &[&str]| git::git(&dir.0, args).unwrap();
    tauri::async_runtime::block_on(async {
        let opt = || {
            Some(git::CommitOptions {
                amend: true,
                signoff: true,
                skip_hooks: true,
            })
        };
        assert!(git::git_commit(root.clone(), "not yet".into(), None, opt())
            .await
            .error
            .unwrap()
            .contains("No commit"));
        fs::write(dir.0.join("one.txt"), "base\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "base"]);
        let original = run(&["rev-parse", "HEAD"]);
        let hook = dir.0.join(".git/hooks/pre-commit");
        fs::write(&hook, "#!/bin/sh\necho validation-rejected >&2\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(git::git_commit(
            root.clone(),
            "blocked".into(),
            None,
            Some(git::CommitOptions {
                amend: true,
                ..Default::default()
            })
        )
        .await
        .error
        .is_some());
        assert_eq!(run(&["rev-parse", "HEAD"]), original);
        assert!(
            git::git_commit(root.clone(), "updated subject".into(), None, opt())
                .await
                .error
                .is_none()
        );
        assert_ne!(run(&["rev-parse", "HEAD"]), original);
        assert_eq!(run(&["rev-list", "--count", "HEAD"]).trim(), "1");
        assert!(run(&["log", "-1", "--format=%B"])
            .contains("Signed-off-by: Test <test@example.invalid>"));
        assert!(hook.exists()); // bypass, not deletion or config mutation
    });
}
#[test]
fn git_remote_lease_rejects_unseen_updates_and_rebase_replays_local_work() {
    let dir =
        Scratch(std::env::temp_dir().join(format!("cairngorm-git-lease-{}", uuid::Uuid::new_v4())));
    let local = dir.0.join("local");
    let remote = dir.0.join("remote.git");
    let other = dir.0.join("other");
    init(&local);
    init(&other);
    fs::create_dir_all(&remote).unwrap();
    git::git(&remote, &["init", "--bare", "-q"]).unwrap();
    let root = local.to_string_lossy().into_owned();
    let run = |args: &[&str]| git::git(&local, args).unwrap();
    run(&["switch", "-c", "main"]);
    fs::write(local.join("base"), "base").unwrap();
    run(&["add", "."]);
    run(&["commit", "-m", "base"]);
    run(&["remote", "add", "origin", &remote.to_string_lossy()]);
    tauri::async_runtime::block_on(async {
        git_ops::git_sync(root.clone(), "publish".into(), None)
            .await
            .unwrap();
        assert_eq!(
            git_ops::git_remotes(root.clone()).await.unwrap(),
            vec!["origin"]
        );
        assert!(git_ops::git_sync(
            root.clone(),
            "fetch".into(),
            Some("--upload-pack=bad".into())
        )
        .await
        .is_err());
        assert!(git_ops::git_sync(
            root.clone(),
            "push".into(),
            Some("https://not-configured.invalid".into())
        )
        .await
        .is_err());
        let other_run = |args: &[&str]| git::git(&other, args).unwrap();
        other_run(&["remote", "add", "origin", &remote.to_string_lossy()]);
        other_run(&["fetch", "origin"]);
        other_run(&["switch", "-c", "main", "origin/main"]);
        fs::write(other.join("upstream"), "upstream").unwrap();
        other_run(&["add", "."]);
        other_run(&["commit", "-m", "upstream"]);
        other_run(&["push", "origin", "main"]);
        let upstream = other_run(&["rev-parse", "HEAD"]);
        fs::write(local.join("local"), "local").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "local"]);
        let old_head = run(&["rev-parse", "HEAD"]);
        assert!(git_ops::git_sync(root.clone(), "force-push".into(), None)
            .await
            .is_err());
        assert_eq!(git::git(&remote, &["rev-parse", "main"]).unwrap(), upstream);
        assert!(git_ops::git_sync(root.clone(), "pull".into(), None)
            .await
            .is_err());
        assert_eq!(run(&["rev-parse", "HEAD"]), old_head);
        git_ops::git_sync(root.clone(), "pull-rebase".into(), None)
            .await
            .unwrap();
        assert_ne!(run(&["rev-parse", "HEAD"]), old_head);
        assert_eq!(fs::read_to_string(local.join("local")).unwrap(), "local");
        assert_eq!(
            fs::read_to_string(local.join("upstream")).unwrap(),
            "upstream"
        );
        git_ops::git_sync(root.clone(), "push".into(), Some("origin".into()))
            .await
            .unwrap();
        // A known upstream may deliberately be replaced, still under its explicit lease.
        run(&["commit", "--amend", "-m", "rewritten local"]);
        git_ops::git_sync(root.clone(), "force-push".into(), None)
            .await
            .unwrap();
        assert_eq!(
            git::git(&remote, &["rev-parse", "main"]).unwrap(),
            run(&["rev-parse", "HEAD"])
        );
    });
}
#[test]
fn git_force_push_uses_remote_upstream_ref_not_tracking_alias() {
    let dir = Scratch(
        std::env::temp_dir().join(format!("cairngorm-git-refspec-{}", uuid::Uuid::new_v4())),
    );
    let local = dir.0.join("local");
    let remote = dir.0.join("remote.git");
    init(&local);
    fs::create_dir_all(&remote).unwrap();
    git::git(&remote, &["init", "--bare", "-q"]).unwrap();
    let root = local.to_string_lossy().into_owned();
    let run = |args: &[&str]| git::git(&local, args).unwrap();
    run(&["switch", "-c", "main"]);
    run(&["commit", "--allow-empty", "-m", "base"]);
    let base = run(&["rev-parse", "HEAD"]);
    run(&["remote", "add", "origin", &remote.to_string_lossy()]);
    run(&["push", "origin", "main:main", "main:alias"]); // sentinel alias initially shares the lease hash
    run(&[
        "config",
        "remote.origin.fetch",
        "+refs/heads/main:refs/remotes/origin/alias",
    ]);
    run(&["config", "branch.main.remote", "origin"]);
    run(&["config", "branch.main.merge", "refs/heads/main"]);
    run(&["fetch", "origin"]);
    assert_eq!(
        run(&["rev-parse", "--symbolic-full-name", "@{upstream}"]).trim(),
        "refs/remotes/origin/alias"
    );
    run(&["commit", "--amend", "--allow-empty", "-m", "rewritten main"]);
    let rewritten = run(&["rev-parse", "HEAD"]);
    tauri::async_runtime::block_on(async {
        git_ops::git_sync(root.clone(), "force-push".into(), None)
            .await
            .unwrap();
        assert_eq!(
            git::git(&remote, &["rev-parse", "refs/heads/main"]).unwrap(),
            rewritten
        );
        assert_eq!(
            git::git(&remote, &["rev-parse", "refs/heads/alias"]).unwrap(),
            base
        );
        run(&["switch", "--detach"]);
        assert!(git_ops::git_sync(root.clone(), "force-push".into(), None)
            .await
            .is_err());
        run(&["switch", "main"]);
        run(&["config", "--unset", "branch.main.merge"]);
        assert!(git_ops::git_sync(root, "force-push".into(), None)
            .await
            .is_err());
        assert_eq!(
            git::git(&remote, &["rev-parse", "refs/heads/main"]).unwrap(),
            rewritten
        );
        assert_eq!(
            git::git(&remote, &["rev-parse", "refs/heads/alias"]).unwrap(),
            base
        );
    });
}

#[test]
fn git_history_paginates_past_fifty_and_includes_merge_parents_and_remote_refs() {
    let dir =
        Scratch(std::env::temp_dir().join(format!("cairngorm-git-pages-{}", uuid::Uuid::new_v4())));
    init(&dir.0);
    let root = dir.0.to_string_lossy().into_owned();
    let run = |args: &[&str]| git::git(&dir.0, args).unwrap();
    tauri::async_runtime::block_on(async {
        assert!(git_history::git_log(root.clone(), 100, None)
            .await
            .unwrap()
            .is_empty());
        run(&["switch", "-c", "main"]);
        for i in 0..101 {
            run(&["commit", "--allow-empty", "-m", &format!("commit {i}")]);
        }
        run(&["switch", "-c", "feature"]);
        run(&["commit", "--allow-empty", "-m", "feature"]);
        run(&["switch", "main"]);
        run(&["commit", "--allow-empty", "-m", "main"]);
        run(&["merge", "--no-ff", "feature", "-m", "merge"]);
        run(&["update-ref", "refs/remotes/secondary/main", "HEAD"]);
        let first = git_history::git_log(root.clone(), 100, None).await.unwrap();
        let second = git_history::git_log(root, 100, Some(100)).await.unwrap();
        assert_eq!(first.len(), 100);
        assert_eq!(second.len(), 4);
        assert_eq!(first[0].parents.len(), 2);
        assert!(first[0].refs.contains(&"secondary/main".into()));
        assert!(!second
            .iter()
            .any(|c| first.iter().any(|p| p.hash == c.hash)));
    });
}
#[test]
fn git_github_links_use_supported_actual_remotes_and_full_hashes() {
    let hash = "a".repeat(40);
    let expected = format!("https://github.com/team/project/commit/{hash}");
    for url in [
        "https://github.com/team/project.git",
        "git@github.com:team/project.git",
        "ssh://git@github.com/team/project.git",
    ] {
        assert_eq!(
            git_commit_details::github_url(url, &hash),
            Some(expected.clone())
        );
    }
    for url in [
        "https://github.com.evil/team/project",
        "https://gitlab.com/team/project",
        "https://github.com/team/project?x",
        "https://github.com/../project",
        "C:/local/repo",
    ] {
        assert!(git_commit_details::github_url(url, &hash).is_none());
    }
    assert!(git_commit_details::github_url("git@github.com:team/project.git", "abc1234").is_none());
}
