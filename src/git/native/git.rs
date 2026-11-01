#[path = "git/config_guard.rs"]
mod config_guard;
#[path = "git/mutations.rs"]
mod mutations;
#[path = "git/status.rs"]
mod status;
pub use mutations::*;
pub use status::*;
// Git commands: thin wrappers around the real `git` binary — no libgit2 dep.
// All commands resolve the repo by walking up from the workspace root looking
// for .git (root may be a subfolder); "no-repo" is returned as a report error,
// not an Err, so the panel renders one hint instead of a crash path.
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_FILES: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub code: String, // porcelain XY, e.g. " M", "M ", "??"
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReport {
    pub files: Vec<GitFile>,
    pub error: Option<String>, // "no-repo" | stderr line
}

fn find_repo(root: &Path) -> Option<PathBuf> {
    root.ancestors()
        .take(8)
        .find(|p| p.join(".git").exists()) // a dir, or a file in linked worktrees
        .map(|p| p.to_path_buf())
}

// Commands run off the main thread now; one git process at a time keeps a
// status refresh from racing a stage/commit for .git/index.lock.
static GIT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

// Commands that change the repo and/or answer with a fresh status run whole,
// one after another (add + status as a unit): replies then reach the UI in
// the order they were asked, so an older report never overwrites a newer one.
static REPORT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn serial<T>(f: impl FnOnce() -> T) -> T {
    let _whole = REPORT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    f()
}

/// A repo-changing command on the blocking pool; a failed task becomes the report error.
pub(crate) async fn report_blocking(f: impl FnOnce() -> GitReport + Send + 'static) -> GitReport {
    crate::blocking(f).await.unwrap_or_else(|e| GitReport {
        files: vec![],
        error: Some(e),
    })
}

pub(crate) fn spawn_git(repo: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let _serial = GIT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // Status refreshes run on project open; the repository's own config must not run code.
    config_guard::check(repo)?;
    let mut c = Command::new("git");
    c.arg("-C")
        .arg(repo)
        .args(config_guard::OVERRIDES)
        .args(config_guard::with_submodules_ignored(args));
    // Status does not rewrite the index, so no post-index-change hook from the folder runs.
    c.env("GIT_OPTIONAL_LOCKS", "0");
    c.env("GIT_LITERAL_PATHSPECS", "1"); // file names are names, never globs ([id].tsx, *.tmp)
    c.env("GIT_TERMINAL_PROMPT", "0"); // no invisible credential prompts in the desktop webview
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW — no console flash per git call
    }
    c.output().map_err(|e| format!("git spawn failed: {e}"))
}

pub(crate) fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = spawn_git(repo, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr)
            .lines()
            .next()
            .unwrap_or("git error")
            .trim_start_matches("fatal: ")
            .to_string())
    }
}

fn full_report(root: &str) -> Result<(PathBuf, GitReport), GitReport> {
    let repo = match find_repo(Path::new(root)) {
        Some(r) => r,
        None => {
            return Err(GitReport {
                files: vec![],
                error: Some("no-repo".into()),
            })
        }
    };
    match status_of(&repo) {
        Ok((files, err)) => Ok((repo, GitReport { files, error: err })),
        Err(e) => Err(GitReport {
            files: vec![],
            error: Some(e),
        }),
    }
}

// Returns (files, inner error). Inner error is Some on stderr-but-parsable runs;
// kept as Ok so the panel still shows the file list when possible.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_z_entries() {
        let raw = b" M src/app/main.rs\0?? new.txt\0R  old.rs\0renamed.rs\0";
        let files = parse_status_z(raw);
        assert_eq!(files.len(), 3);
        assert_eq!(
            (files[0].path.as_str(), files[0].code.as_str()),
            ("src/app/main.rs", " M")
        );
        assert_eq!(
            (files[1].path.as_str(), files[1].code.as_str()),
            ("new.txt", "??")
        );
        assert_eq!(
            (files[2].path.as_str(), files[2].code.as_str()),
            ("renamed.rs", "R ")
        );
    }

    #[test]
    fn caps_file_list() {
        let mut raw: Vec<u8> = Vec::new();
        for i in 0..(MAX_FILES + 10) {
            raw.extend_from_slice(format!(" M f{}.rs\0", i).as_bytes());
        }
        assert_eq!(parse_status_z(&raw).len(), MAX_FILES);
    }
}
