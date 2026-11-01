use super::{git, repo};
#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub ahead: u32,
    pub behind: u32,
    pub remote: Option<String>,
    pub upstream: bool,
}

/// Locally known incoming/outgoing commits; opening the panel never fetches.
#[tauri::command]
pub async fn git_remote_status(root: String) -> Result<RemoteStatus, String> {
    crate::blocking(move || {
        let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
        let branch = git(&repo, &["symbolic-ref", "--quiet", "HEAD"]).unwrap_or_default();
        if branch.trim().is_empty() {
            return Ok(RemoteStatus {
                ahead: 0,
                behind: 0,
                remote: None,
                upstream: false,
            });
        }
        let remote = git(
            &repo,
            &[
                "for-each-ref",
                "--format=%(upstream:remotename)",
                branch.trim(),
            ],
        )?;
        if !remote.trim().is_empty() {
            let counts = git(
                &repo,
                &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            )?;
            let mut counts = counts.split_whitespace();
            let mut count = || {
                counts
                    .next()
                    .ok_or("Missing upstream count")?
                    .parse::<u32>()
                    .map_err(|e| e.to_string())
            };
            return Ok(RemoteStatus {
                ahead: count()?,
                behind: count()?,
                remote: Some(remote.trim().into()),
                upstream: true,
            });
        }
        let remotes = git(&repo, &["remote"])?;
        let remote = remotes
            .lines()
            .find(|r| *r == "origin")
            .or_else(|| remotes.lines().next())
            .map(String::from);
        let ahead = match git(&repo, &["rev-list", "--count", "HEAD"]) {
            Ok(count) => count.trim().parse::<u32>().map_err(|e| e.to_string())?,
            Err(_) => 0, // unborn branch: nothing to publish yet
        };
        Ok(RemoteStatus {
            ahead,
            behind: 0,
            remote,
            upstream: false,
        })
    })
    .await?
}

#[tauri::command]
pub async fn git_remotes(root: String) -> Result<Vec<String>, String> {
    crate::blocking(move || {
        let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
        Ok(git(&repo, &["remote"])?.lines().map(String::from).collect())
    })
    .await?
}

#[tauri::command]
pub async fn git_sync(root: String, action: String, remote: Option<String>) -> Result<(), String> {
    crate::blocking(move || crate::git::serial(|| {
        let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
        if let Some(name) = remote.as_deref() {
            if name.starts_with('-') || !git(&repo, &["remote"])?.lines().any(|r| r == name) {
                return Err("Choose a configured remote".into());
            }
        }
        let mut args: Vec<&str> = match action.as_str() {
            "pull" => vec!["pull", "--ff-only"],
            "pull-rebase" => vec!["pull", "--rebase", "--no-autostash"],
            "fetch" => if remote.is_some() { vec!["fetch", "--prune"] } else { vec!["fetch", "--all", "--prune"] },
            "push" => vec!["push"],
            "publish" => vec!["push", "--set-upstream"],
            "force-push" | "push-upstream" => vec!["push"],
            _ => return Err("Unknown sync action".into()),
        };
        if matches!(action.as_str(), "force-push" | "push-upstream") {
            // A fetch refspec may rename tracking refs: use Git's actual remote-ref mapping.
            let branch = git(&repo, &["symbolic-ref", "--quiet", "HEAD"])?;
            let mapping = git(&repo, &["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)%00%(objectname)", branch.trim()])?;
            let fields: Vec<_> = mapping.trim_end().split('\0').collect();
            let [name, destination, tracking, source] = fields.as_slice() else { return Err("Cannot resolve upstream mapping".into()); };
            if name.starts_with('-') || !git(&repo, &["remote"])?.lines().any(|r| r == *name)
                || !destination.starts_with("refs/heads/") || git(&repo, &["check-ref-format", destination]).is_err()
                || tracking.is_empty() || source.is_empty() { return Err("No valid remote branch upstream".into()); }
            if remote.as_deref().is_some_and(|r| r != *name) { return Err("Push must target the current upstream remote".into()); }
            let target = format!("{source}:{destination}");
            if action == "push-upstream" { return git(&repo, &["push", name, &target]).map(|_| ()); }
            let expected = git(&repo, &["rev-parse", "--verify", &format!("{tracking}^{{commit}}")])?;
            let lease = format!("--force-with-lease={destination}:{}", expected.trim());
            return git(&repo, &["push", &lease, name, &target]).map(|_| ());
        }
        if let Some(name) = remote.as_deref() { args.push(name); }
        if action == "publish" { if remote.is_none() { args.push("origin"); } args.push("HEAD"); }
        else if action == "push" && remote.is_some() { args.push("HEAD"); }
        // Pull uses the configured upstream. Selecting a remote is only supported for fetch/push.
        if matches!(action.as_str(), "pull" | "pull-rebase") && remote.is_some() { return Err("Pull uses the current upstream".into()); }
        git(&repo, &args).map(|_| ())
    })).await?
}
