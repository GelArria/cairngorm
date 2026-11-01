#[path = "git/remotes.rs"]
mod remotes;
pub use remotes::*;
// Git actions behind the right-click menus: discard changes, ignore a path.
use crate::git::{git, repo, GitReport};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

fn fail(e: String) -> GitReport {
    GitReport {
        files: vec![],
        error: Some(e),
    }
}

/// Throw away a file's changes: restore tracked paths (index + worktree) to HEAD,
/// delete untracked ones. A file that was only ever staged (no HEAD version) is
/// removed outright. The UI asks for confirmation first, and shows `error`.
#[tauri::command]
pub async fn git_discard(root: String, path: String, untracked: bool) -> GitReport {
    crate::git::report_blocking(move || {
        crate::git::serial(|| {
            let repo = match repo(&root) {
                Ok(r) => r,
                Err(e) => return e,
            };
            let res = if untracked {
                git(&repo, &["clean", "-fdq", "--", &path])
            } else {
                git(
                    &repo,
                    &[
                        "restore",
                        "--source=HEAD",
                        "--staged",
                        "--worktree",
                        "--",
                        &path,
                    ],
                )
                .or_else(|first| git(&repo, &["rm", "-rfq", "--", &path]).map_err(|_| first))
            };
            if let Err(e) = res {
                return fail(e);
            }
            crate::git::report_after(&root)
        })
    })
    .await
}

/// Gitignore pattern for `abs` relative to the repo root: anchored ("/dir/file"),
/// glob characters escaped, trailing slash for folders. None when outside the repo.
fn ignore_pattern(repo: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(repo).ok()?;
    let rel = rel.to_string_lossy();
    let rel = if cfg!(windows) {
        rel.replace('\\', "/")
    } else {
        rel.into_owned()
    };
    if rel.is_empty() {
        return None;
    }
    let mut s = String::from("/");
    for ch in rel.chars() {
        if matches!(ch, '*' | '?' | '[' | ']') || (ch == '\\' && !cfg!(windows)) {
            s.push('\\');
        }
        s.push(ch);
    }
    if s.ends_with(' ') {
        s.insert(s.len() - 1, '\\');
    } // a trailing space is stripped by git unless escaped
    if abs.is_dir() {
        s.push('/');
    }
    Some(s)
}

/// Where the local-only ignore list lives (works in linked worktrees, where `.git` is a file).
fn exclude_file(repo: &Path) -> PathBuf {
    match git(repo, &["rev-parse", "--git-path", "info/exclude"]) {
        Ok(p) if !p.trim().is_empty() => {
            let p = PathBuf::from(p.trim());
            if p.is_absolute() {
                p
            } else {
                repo.join(p)
            }
        }
        _ => repo.join(".git").join("info").join("exclude"),
    }
}

/// Append `path` to .gitignore (shared) or the repo's info/exclude (local only).
/// Returns the pattern written; Err when already listed or when the file is
/// tracked (ignoring a tracked file has no effect until it is untracked).
#[tauri::command(async)]
pub fn git_ignore(root: String, path: String, local: bool) -> Result<String, String> {
    let repo = repo(&root).map_err(|_| "Not a git repository".to_string())?;
    let abs = Path::new(&path);
    let pattern = ignore_pattern(&repo, abs).ok_or("Path is outside the repository")?;
    let rel = abs
        .strip_prefix(&repo)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    if git(&repo, &["ls-files", "--error-unmatch", "--", &rel]).is_ok() {
        return Err(format!("{rel} is tracked by git — ignoring it has no effect until it is untracked (git rm --cached)"));
    }
    let file = if local {
        exclude_file(&repo)
    } else {
        repo.join(".gitignore")
    };
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let existing = fs::read_to_string(&file).unwrap_or_default();
    let bare = pattern.trim_start_matches('/');
    if existing
        .lines()
        .any(|l| l.trim().trim_start_matches('/') == bare)
    {
        return Err(format!("{pattern} is already ignored"));
    }
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|e| e.to_string())?;
    if !existing.is_empty() && !existing.ends_with('\n') {
        f.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    writeln!(f, "{pattern}").map_err(|e| e.to_string())?;
    Ok(pattern)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchors_pattern_to_repo_root() {
        let repo = Path::new("/work/proj");
        assert_eq!(
            ignore_pattern(repo, Path::new("/work/proj/src/a.log")).as_deref(),
            Some("/src/a.log")
        );
        assert_eq!(ignore_pattern(repo, Path::new("/elsewhere/a.log")), None);
        assert_eq!(ignore_pattern(repo, Path::new("/work/proj")), None);
    }

    #[test]
    fn escapes_glob_characters_and_trailing_space() {
        let repo = Path::new("/work/proj");
        assert_eq!(
            ignore_pattern(repo, Path::new("/work/proj/a[1]*.txt")).as_deref(),
            Some("/a\\[1\\]\\*.txt")
        );
        assert_eq!(
            ignore_pattern(repo, Path::new("/work/proj/trail ")).as_deref(),
            Some("/trail\\ ")
        );
    }
}
