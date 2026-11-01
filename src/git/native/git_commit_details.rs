// Historical reads only: never consult or modify the index/worktree.
use crate::git::{git, repo};
use serde::Serialize;
use std::{collections::HashMap, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub added: Option<u64>,
    pub removed: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub date: String,
    pub refs: Vec<String>,
    pub message: String,
    pub files: Vec<CommitFile>,
    pub parents: Vec<String>,
    pub github_url: Option<String>,
}

pub(crate) fn github_url(remote: &str, hash: &str) -> Option<String> {
    if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let path = remote
        .trim()
        .strip_prefix("https://github.com/")
        .or_else(|| remote.trim().strip_prefix("http://github.com/"))
        .or_else(|| remote.trim().strip_prefix("git@github.com:"))
        .or_else(|| remote.trim().strip_prefix("ssh://git@github.com/"))
        .or_else(|| remote.trim().strip_prefix("ssh://git@github.com:22/"))?;
    let path = path
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(path.trim_end_matches('/'));
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|p| {
            p.is_empty()
                || *p == "."
                || *p == ".."
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        })
    {
        return None;
    }
    Some(format!("https://github.com/{path}/commit/{hash}"))
}

fn commit_url(repo: &Path, hash: &str) -> Option<String> {
    let upstream = git(repo, &["rev-parse", "--symbolic-full-name", "@{upstream}"]).ok();
    let names = git(repo, &["remote"]).ok()?;
    let remotes: Vec<_> = names.lines().collect();
    let remote = upstream
        .as_deref()
        .and_then(|s| s.trim().strip_prefix("refs/remotes/"))
        .and_then(|s| s.split('/').next())
        .or_else(|| remotes.iter().copied().find(|r| *r == "origin"))
        .or_else(|| {
            if remotes.len() == 1 {
                Some(remotes[0])
            } else {
                None
            }
        })?;
    let url = git(repo, &["remote", "get-url", remote]).ok()?;
    github_url(&url, hash)
}

fn resolve(repo: &Path, hash: &str) -> Result<String, String> {
    if !(4..=64).contains(&hash.len()) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid commit hash".into());
    }
    Ok(git(
        repo,
        &["rev-parse", "--verify", &format!("{hash}^{{commit}}")],
    )?
    .trim()
    .into())
}

// Merge commits compare with their first parent; root commits compare with empty tree.
fn diff(repo: &Path, hash: &str, options: &[&str], paths: &[&str]) -> Result<String, String> {
    let parent = git(repo, &["rev-parse", "--verify", &format!("{hash}^1")]).ok();
    let mut args = vec![
        "diff-tree",
        "--root",
        "--no-commit-id",
        "-r",
        "-M",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
    ];
    args.extend(options);
    if let Some(parent) = parent.as_deref() {
        args.push(parent.trim());
    }
    args.push(hash);
    args.push("--");
    args.extend(paths);
    git(repo, &args)
}

fn parse_files(status: &str, stats: &str) -> Vec<CommitFile> {
    let mut counts = HashMap::new();
    let mut entries = stats.split('\0').filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        let mut fields = entry.splitn(3, '\t');
        let added = fields.next().and_then(|s| s.parse::<u64>().ok());
        let removed = fields.next().and_then(|s| s.parse::<u64>().ok());
        let Some(mut path) = fields.next() else {
            continue;
        };
        if path.is_empty() {
            let _old = entries.next();
            path = entries.next().unwrap_or("");
        }
        counts.insert(path, (added, removed));
    }
    let mut files = Vec::new();
    let mut entries = status.split('\0').filter(|e| !e.is_empty());
    while let Some(code) = entries.next() {
        let Some(mut path) = entries.next() else {
            break;
        };
        let old_path = if code.starts_with('R') || code.starts_with('C') {
            let old = path.to_string();
            path = entries.next().unwrap_or("");
            Some(old)
        } else {
            None
        };
        let (added, removed) = counts.get(path).copied().unwrap_or((Some(0), Some(0)));
        files.push(CommitFile {
            path: path.into(),
            old_path,
            status: code.into(),
            added,
            removed,
        });
    }
    files
}

pub(crate) fn details(root: &str, hash: &str) -> Result<CommitDetails, String> {
    let repo = repo(root).map_err(|_| "no-repo".to_string())?;
    let hash = resolve(&repo, hash)?;
    let header = git(
        &repo,
        &[
            "show",
            "-s",
            "--format=%H%x00%an%x00%ae%x00%aI%x00%D%x00%P%x00%B",
            &hash,
            "--",
        ],
    )?;
    let mut parts = header.splitn(7, '\0');
    let mut next = || parts.next().unwrap_or("").to_string();
    let (hash, author, email, date, refs, parents, message) =
        (next(), next(), next(), next(), next(), next(), next());
    let status = diff(&repo, &hash, &["--name-status", "-z"], &[])?;
    let stats = diff(&repo, &hash, &["--numstat", "-z"], &[])?;
    Ok(CommitDetails {
        github_url: commit_url(&repo, &hash),
        parents: parents.split_whitespace().map(String::from).collect(),
        hash,
        author,
        email,
        date,
        refs: refs
            .split(", ")
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect(),
        message: message.trim_end().into(),
        files: parse_files(&status, &stats),
    })
}

#[tauri::command]
pub async fn git_commit_details(root: String, hash: String) -> Result<CommitDetails, String> {
    crate::blocking(move || details(&root, &hash)).await?
}

pub(crate) fn file_diff(
    root: &str,
    hash: &str,
    path: &str,
    old_path: Option<&str>,
) -> Result<String, String> {
    let repo = repo(root).map_err(|_| "no-repo".to_string())?;
    let hash = resolve(&repo, hash)?;
    // Require a real changed path: an empty pathspec must never fetch a whole repo patch.
    let commit = details(root, &hash)?;
    let file = commit
        .files
        .iter()
        .find(|f| f.path == path && f.old_path.as_deref() == old_path)
        .ok_or("File is not part of this commit")?;
    let mut paths = vec![file.path.as_str()];
    if let Some(old) = file.old_path.as_deref() {
        paths.push(old);
    }
    let patch = diff(&repo, &hash, &["-p"], &paths)?;
    if patch.len() > 2_000_000 {
        return Err(
            "This file diff exceeds the 2 MB display limit. View it with Git locally.".into(),
        );
    }
    Ok(patch)
}

#[tauri::command]
pub async fn git_commit_diff(
    root: String,
    hash: String,
    path: String,
    old_path: Option<String>,
) -> Result<String, String> {
    crate::blocking(move || file_diff(&root, &hash, &path, old_path.as_deref())).await?
}
