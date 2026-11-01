// A folder can carry its own .git/config (archive, shared drive): Git would run its commands
// during a plain status. Real Git repos in a temp folder; never touches the developer's repo.
use super::command_key;
use std::{fs, path::PathBuf, process::Command};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Raw Git setup that bypasses the guard, as the folder's author would have done.
fn raw_git(repo: &PathBuf, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap()
        .status
        .success();
    assert!(ok, "git {args:?} failed");
}

fn listing(entries: &[(&str, &str, &str)]) -> String {
    entries
        .iter()
        .map(|(scope, key, value)| format!("{scope}\0{key}\n{value}\0"))
        .collect()
}

#[test]
fn repository_config_that_runs_commands_is_named() {
    let cases = [
        (
            ("local", "core.fsmonitor", "echo pwned #"),
            Some("core.fsmonitor"),
        ),
        (
            ("local", "filter.x.clean", "sh -c 'id'"),
            Some("filter.x.clean"),
        ),
        (
            ("worktree", "Filter.Doc.Smudge", "run"),
            Some("Filter.Doc.Smudge"),
        ),
        (
            ("local", "diff.pdf.textconv", "pdftotext"),
            Some("diff.pdf.textconv"),
        ),
        (("local", "diff.external", "my-diff"), Some("diff.external")),
    ];
    for ((scope, key, value), expected) in cases {
        assert_eq!(
            command_key(&listing(&[(scope, key, value)])).as_deref(),
            expected,
            "{key}"
        );
    }
}

#[test]
fn user_config_lfs_and_builtin_fsmonitor_are_allowed() {
    let safe = listing(&[
        ("system", "diff.astextplain.textconv", "astextplain"),
        ("global", "filter.custom.clean", "my-own-tool"),
        ("local", "filter.lfs.clean", "git-lfs clean -- %f"),
        ("local", "filter.lfs.smudge", "git-lfs smudge -- %f"),
        ("local", "filter.lfs.process", "git-lfs filter-process"),
        ("local", "filter.lfs.required", "true"),
        ("local", "core.fsmonitor", "true"),
        ("local", "core.sshcommand", "ssh -i ~/.ssh/work"),
        ("command", "core.fsmonitor", "anything"),
    ]);
    assert_eq!(command_key(&safe), None);
    // A changed LFS command is no longer the user's git-lfs.
    let changed = listing(&[("local", "filter.lfs.clean", "git-lfs clean -- %f; id")]);
    assert_eq!(command_key(&changed).as_deref(), Some("filter.lfs.clean"));
}

#[test]
fn status_in_a_folder_with_a_hostile_filter_refuses_and_runs_nothing() {
    let dir =
        Scratch(std::env::temp_dir().join(format!("cairngorm-git-guard-{}", uuid::Uuid::new_v4())));
    let repo = dir.0.join("extracted");
    fs::create_dir_all(&repo).unwrap();
    raw_git(&repo, &["init", "-q"]);
    raw_git(&repo, &["config", "user.name", "Test"]);
    raw_git(&repo, &["config", "user.email", "test@example.invalid"]);
    raw_git(&repo, &["config", "core.autocrlf", "false"]);
    fs::write(repo.join(".gitattributes"), "a.txt filter=x\n").unwrap();
    fs::write(repo.join("a.txt"), "hi\n").unwrap();
    raw_git(&repo, &["add", "-A"]);
    raw_git(&repo, &["commit", "-q", "-m", "init"]);
    assert!(crate::git::git(&repo, &["status", "--porcelain"]).is_ok());

    let marker = dir.0.join("filter-ran.txt");
    let command = format!(
        "sh -c 'echo ran > \"{}\"; cat'",
        marker.to_string_lossy().replace('\\', "/")
    );
    raw_git(&repo, &["config", "filter.x.clean", &command]);
    // A new modification time makes Git re-read the file through the filter.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(repo.join("a.txt"), "hi\n").unwrap();

    let error = crate::git::git(&repo, &["status", "--porcelain=v1", "-z", "-uall"]).unwrap_err();
    assert!(error.contains("filter.x.clean"), "{error}");
    assert!(!marker.exists(), "the repository's filter command ran");
}

#[test]
fn values_git_runs_as_commands_are_refused_even_when_they_look_boolean() {
    // Git does not trim a quoted value: " true" is a command, "2" is a boolean.
    let spaced = listing(&[("local", "core.fsmonitor", " true")]);
    assert_eq!(command_key(&spaced).as_deref(), Some("core.fsmonitor"));
    assert_eq!(
        command_key(&listing(&[("local", "core.fsmonitor", "2")])),
        None
    );
    let lfs = listing(&[
        ("local", "filter.lfs.smudge", "git-lfs smudge --skip -- %f"),
        (
            "local",
            "filter.lfs.process",
            "git-lfs filter-process --skip",
        ),
        ("local", "filter.lfs.clean", "git-lfs clean %f"),
    ]);
    assert_eq!(command_key(&lfs), None);
}

#[test]
fn status_and_diff_skip_submodules_and_every_call_overrides_repository_commands() {
    use super::{with_submodules_ignored, OVERRIDES};
    assert_eq!(
        with_submodules_ignored(&["status", "--porcelain"]),
        ["status", "--ignore-submodules=all", "--porcelain"]
    );
    assert_eq!(
        with_submodules_ignored(&["-c", "core.quotepath=false", "diff", "--", "a"]),
        [
            "-c",
            "core.quotepath=false",
            "diff",
            "--ignore-submodules=all",
            "--",
            "a"
        ]
    );
    assert_eq!(with_submodules_ignored(&["log", "-n1"]), ["log", "-n1"]);
    let joined = OVERRIDES.join(" ");
    assert!(joined.contains("core.fsmonitor=false") && joined.contains("log.showSignature=false"));
}

#[test]
fn a_hook_shipped_in_the_folder_does_not_run_on_status() {
    let dir =
        Scratch(std::env::temp_dir().join(format!("cairngorm-git-hook-{}", uuid::Uuid::new_v4())));
    let repo = dir.0.join("extracted");
    fs::create_dir_all(&repo).unwrap();
    raw_git(&repo, &["init", "-q"]);
    raw_git(&repo, &["config", "user.name", "Test"]);
    raw_git(&repo, &["config", "user.email", "test@example.invalid"]);
    fs::write(repo.join("a.txt"), "hi\n").unwrap();
    raw_git(&repo, &["add", "-A"]);
    raw_git(&repo, &["commit", "-q", "-m", "init"]);
    let marker = dir.0.join("hook-ran.txt");
    let hook = repo.join(".git/hooks/post-index-change");
    fs::write(
        &hook,
        format!(
            "#!/bin/sh\necho ran > \"{}\"\n",
            marker.to_string_lossy().replace('\\', "/")
        ),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(repo.join("a.txt"), "hi\n").unwrap();
    crate::git::git(&repo, &["status", "--porcelain=v1", "-z", "-uall"]).unwrap();
    assert!(!marker.exists(), "the folder's post-index-change hook ran");
}
