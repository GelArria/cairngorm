// Branch / history operations use the same serial lock as stage and commit.
use crate::git::{git, repo, serial};
use std::path::Path;

#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<String>, String> {
    crate::blocking(move || {
        let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
        let refs = git(
            &repo,
            &[
                "for-each-ref",
                "--format=%(refname:short) %(symref)",
                "refs/heads",
                "refs/remotes",
            ],
        )?;
        // Symbolic remote HEAD is not a branch to switch to.
        Ok(refs
            .lines()
            .filter_map(|line| line.strip_suffix(' ').map(String::from))
            .collect())
    })
    .await?
}

#[tauri::command]
pub async fn git_switch(root: String, branch: String, create: bool) -> Result<(), String> {
    crate::blocking(move || {
        serial(|| {
            let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
            if branch.is_empty() || branch.starts_with('-') {
                return Err("Invalid branch name".into());
            }
            git(&repo, &["check-ref-format", "--branch", &branch])?;
            let args = if create {
                vec!["switch", "-c", &branch]
            } else {
                vec!["switch", &branch]
            };
            // `switch origin/topic` would detach / fail. Track its fully qualified
            // remote ref instead; no force, stash or reset of the user's work.
            let remote = !create
                && git(
                    &repo,
                    &["show-ref", "--verify", &format!("refs/heads/{branch}")],
                )
                .is_err()
                && git(
                    &repo,
                    &["show-ref", "--verify", &format!("refs/remotes/{branch}")],
                )
                .is_ok();
            if remote {
                git(&repo, &["switch", "--track", &branch]).map(|_| ())
            } else {
                git(&repo, &args).map(|_| ())
            }
        })
    })
    .await?
}

pub(crate) fn commit_action(repo: &Path, action: &str, hash: Option<&str>) -> Result<(), String> {
    match action {
        "cherry-pick" | "revert" => {
            let hash = hash
                .filter(|h| (4..=64).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit()))
                .ok_or("Invalid commit hash")?;
            if !git(repo, &["status", "--porcelain"])?.is_empty() {
                return Err("Commit or stash your changes before changing history.".into());
            }
            // Resolve only commits, never arbitrary revision expressions/options.
            git(
                repo,
                &["rev-parse", "--verify", &format!("{hash}^{{commit}}")],
            )?;
            let args = if action == "revert" {
                vec!["revert", "--no-edit", hash]
            } else {
                vec!["cherry-pick", hash]
            };
            git(repo, &args).map(|_| ())
        }
        "cherry-pick-continue" => git(
            repo,
            &["-c", "core.editor=true", "cherry-pick", "--continue"],
        )
        .map(|_| ()),
        "cherry-pick-abort" => git(repo, &["cherry-pick", "--abort"]).map(|_| ()),
        "revert-continue" => {
            git(repo, &["-c", "core.editor=true", "revert", "--continue"]).map(|_| ())
        }
        "revert-abort" => git(repo, &["revert", "--abort"]).map(|_| ()),
        _ => Err("Unknown history action".into()),
    }
}

#[tauri::command]
pub async fn git_commit_action(
    root: String,
    action: String,
    hash: Option<String>,
) -> Result<(), String> {
    crate::blocking(move || {
        serial(|| {
            let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
            commit_action(&repo, &action, hash.as_deref())
        })
    })
    .await?
}

/// The history operation waiting for Continue / Abort, if any ("cherry-pick" or
/// "revert"). Read-only: checks git's state files, no lock needed.
#[tauri::command]
pub async fn git_pending_operation(root: String) -> Result<Option<String>, String> {
    crate::blocking(move || {
        let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
        for (file, name) in [
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REVERT_HEAD", "revert"),
        ] {
            let path = git(&repo, &["rev-parse", "--git-path", file])?;
            if repo.join(path.trim()).exists() {
                return Ok(Some(name.to_string()));
            }
        }
        Ok(None)
    })
    .await?
}
