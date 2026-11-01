// History-side git commands: per-file last-touch info and diffs. Kept apart
// from git.rs (status/stage/commit) to stay under the 200-line file rule;
// shares spawn_git/repo from crate::git.
use crate::git::{git, repo, spawn_git};
use serde::Serialize;

const MAX_LOG_COMMITS: usize = 300;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileInfo {
    pub path: String,
    pub hash: String,
    pub author: String,
    pub email: String,
    pub at: u64, // unix epoch seconds of the last commit touching this path
    pub subject: String,
}

// One spawn for the whole repo: git log --name-only, newest first; the FIRST
// block mentioning a path is that file's last change. Header lines carry
// \x1f-separated fields: %h %an %ae %at %s. Files outside the last 300 commits
// get no entry (frontend skips missing ones).
fn parse_log_name_only(out: &str) -> Vec<GitFileInfo> {
    let mut files: Vec<GitFileInfo> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut current: Option<(&str, &str, &str, &str, &str)> = None; // hash, author, email, at, subject
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\x1f').collect();
        if parts.len() >= 5 {
            current = Some((parts[0], parts[1], parts[2], parts[3], parts[4]));
            continue;
        }
        if let Some((hash, author, email, at, subject)) = current {
            let path = line.trim();
            if path.is_empty() || !seen.insert(path.to_string()) {
                continue;
            }
            files.push(GitFileInfo {
                path: path.to_string(),
                hash: hash.to_string(),
                author: author.to_string(),
                email: email.to_string(),
                at: at.parse().unwrap_or(0),
                subject: subject.to_string(),
            });
        }
    }
    files
}

#[tauri::command]
pub async fn git_file_details(root: String) -> Result<Vec<GitFileInfo>, String> {
    crate::blocking(move || file_details(root)).await?
}

fn file_details(root: String) -> Result<Vec<GitFileInfo>, String> {
    let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
    let out = spawn_git(
        &repo,
        &[
            "log",
            &format!("-n{MAX_LOG_COMMITS}"),
            "--name-only",
            "--pretty=format:%h%x1f%an%x1f%ae%x1f%at%x1f%s",
        ],
    )?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr)
            .lines()
            .next()
            .unwrap_or("git error")
            .to_string());
    }
    Ok(parse_log_name_only(&String::from_utf8_lossy(&out.stdout)))
}

// kind: "staged" (HEAD..index), "unstaged" (index..worktree), "untracked"
// (no-index vs the null device — exit code 1 with empty stderr means diff).
#[tauri::command]
pub async fn git_diff(root: String, path: String, kind: String) -> Result<String, String> {
    crate::blocking(move || diff(root, path, kind)).await?
}

fn diff(root: String, path: String, kind: String) -> Result<String, String> {
    let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
    let args: Vec<&str> = match kind.as_str() {
        "staged" => vec!["diff", "--cached", "--", &path],
        "untracked" => vec!["diff", "--no-index", "--", "/dev/null", &path],
        _ => vec!["diff", "--", &path],
    };
    let out = spawn_git(&repo, &args)?;
    if let Some(err) = diff_error(&String::from_utf8_lossy(&out.stderr)) {
        return Err(err);
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Only real failures abort a diff: git also writes advisories to stderr
/// ("warning: in the working copy of 'x', LF will be replaced by CRLF…") on
/// a successful diff, and those used to hide the diff behind an error.
fn diff_error(stderr: &str) -> Option<String> {
    stderr
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("fatal:") || l.starts_with("error:") || l.starts_with("usage:"))
        .map(|l| {
            l.trim_start_matches("fatal: ")
                .trim_start_matches("error: ")
                .to_string()
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub author: String,
    pub email: String,
    pub time: String,
    pub subject: String,
    /// Abbreviated parent hashes (2+ = merge) — the history graph draws lanes from these.
    pub parents: Vec<String>,
    /// Decorations: "HEAD -> main", "origin/main", "feat/x", "tag: v1".
    pub refs: Vec<String>,
    /// Committer time, unix seconds (compact ages on the client).
    pub at: i64,
}

// History and the git mutex may wait: keep both off the shared async workers.
#[tauri::command]
pub async fn git_log(
    root: String,
    max: usize,
    skip: Option<usize>,
) -> Result<Vec<GitCommit>, String> {
    crate::blocking(move || log(root, max, skip.unwrap_or(0))).await?
}

fn log(root: String, max: usize, skip: usize) -> Result<Vec<GitCommit>, String> {
    let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
    let max = if max == 0 {
        100
    } else {
        max.min(MAX_LOG_COMMITS)
    };
    // Empty repositories have neither HEAD nor refs; they are valid, empty histories.
    let head = git(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok();
    if !head
        && git(&repo, &["for-each-ref", "--format=%(refname)"])?
            .trim()
            .is_empty()
    {
        return Ok(vec![]);
    }
    // HEAD (also when detached) + local branches (unmerged work shows as its own
    // lane); topo order keeps a branch's commits contiguous for the lane layout.
    let count = format!("-n{max}");
    let offset = format!("--skip={skip}");
    let mut args = vec![
        "log",
        "--all",
        "--topo-order",
        "--decorate=short",
        &count,
        &offset,
        "--pretty=format:%h%x1f%an%x1f%ar%x1f%s%x1f%p%x1f%D%x1f%ct%x1f%ae",
    ];
    if head {
        args.push("HEAD");
    }
    let out = git(&repo, &args)?;
    Ok(out
        .lines()
        .filter(|l| !l.is_empty())
        .map(parse_log_line)
        .collect())
}

fn parse_log_line(l: &str) -> GitCommit {
    let mut f = l.split('\x1f');
    let mut next = || f.next().unwrap_or("").to_string();
    let (hash, author, time, subject, parents, refs, at, email) = (
        next(),
        next(),
        next(),
        next(),
        next(),
        next(),
        next(),
        next(),
    );
    GitCommit {
        hash,
        author,
        email,
        time,
        subject,
        parents: parents.split_whitespace().map(String::from).collect(),
        refs: refs
            .split(", ")
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(String::from)
            .collect(),
        at: at.trim().parse().unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_log_line_with_parents_and_refs() {
        let c = parse_log_line("b3a91f0\x1fGel\x1f1 hour ago\x1fMerge x\x1fa1 b2\x1fHEAD -> main, origin/main\x1f1790000000\x1fGel@users.noreply.github.com");
        assert_eq!(c.parents, vec!["a1", "b2"]);
        assert_eq!(c.refs, vec!["HEAD -> main", "origin/main"]);
        assert_eq!(c.at, 1790000000);
        assert_eq!(c.email, "Gel@users.noreply.github.com");
        let root = parse_log_line("94484ac\x1fGel\x1f5 days ago\x1fInit\x1f\x1f\x1f1");
        assert!(root.parents.is_empty() && root.refs.is_empty());
        assert!(root.email.is_empty());
    }

    #[test]
    fn parses_log_blocks() {
        let raw = concat!(
            "abc1234\x1fGelArria\x1fa@b.c\x1f1700000000\x1fadd README\n",
            "src/a.rs\nsrc/b.rs\n",
            "def5678\x1fbob\x1fbob@b.c\x1f1699990000\x1ffix\n",
            "src/a.rs\n"
        );
        let files = parse_log_name_only(raw);
        assert_eq!(files.len(), 2); // src/a.rs appears in two blocks — newest wins, dup skipped
        assert_eq!(files[0].path, "src/a.rs");
        assert_eq!(
            (
                files[0].hash.as_str(),
                files[0].author.as_str(),
                files[0].email.as_str()
            ),
            ("abc1234", "GelArria", "a@b.c")
        );
        assert_eq!(files[0].subject, "add README");
        assert_eq!(files[1].path, "src/b.rs");
    }

    #[test]
    fn diff_ignores_warnings_but_reports_fatal() {
        assert_eq!(diff_error("warning: in the working copy of 'a.rs', LF will be replaced by CRLF the next time Git touches it
"), None);
        assert_eq!(diff_error(""), None);
        assert_eq!(
            diff_error(
                "warning: x
fatal: bad revision 'HEAD'
"
            )
            .as_deref(),
            Some("bad revision 'HEAD'")
        );
    }

    #[test]
    fn empty_log_yields_empty() {
        assert!(parse_log_name_only("").is_empty());
    }
}
