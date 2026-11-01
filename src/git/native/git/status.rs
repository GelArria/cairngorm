use super::{
    find_repo, full_report, report_blocking, serial, spawn_git, GitFile, GitReport, MAX_FILES,
};
use std::path::{Path, PathBuf};
pub(super) fn status_of(repo: &Path) -> Result<(Vec<GitFile>, Option<String>), String> {
    let out = spawn_git(repo, &["status", "--porcelain=v1", "-z", "-uall"])?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr)
            .lines()
            .next()
            .unwrap_or("git error")
            .to_string());
    }
    let bytes = out.stdout;
    Ok((parse_status_z(&bytes), None))
}

// porcelain v1 -z: "XY path\0" entries; renames add a second field with the new path.
pub(super) fn parse_status_z(bytes: &[u8]) -> Vec<GitFile> {
    let mut files = Vec::new();
    let mut iter = bytes.split(|b| *b == 0).filter(|s| !s.is_empty());
    while let Some(entry) = iter.next() {
        if files.len() >= MAX_FILES {
            break;
        }
        let entry = String::from_utf8_lossy(entry);
        if entry.len() < 4 {
            continue;
        }
        let code = entry[..2].to_string();
        let mut name = entry[3..].to_string();
        // rename entries carry a second NUL field: old path, then new path
        if code.starts_with('R') {
            if let Some(new) = iter.next() {
                name = String::from_utf8_lossy(new).into_owned();
            }
        }
        files.push(GitFile { path: name, code });
    }
    files
}

pub(crate) fn report_after(root: &str) -> GitReport {
    match full_report(root) {
        Ok((_, r)) => r,
        Err(r) => r,
    }
}

pub(crate) fn repo(root: &str) -> Result<PathBuf, GitReport> {
    find_repo(Path::new(root)).ok_or_else(|| GitReport {
        files: vec![],
        error: Some("no-repo".into()),
    })
}

#[tauri::command]
pub async fn git_status(root: String) -> GitReport {
    report_blocking(move || serial(|| report_after(&root))).await
}

/// Repo root the workspace folder resolves to (walk-up), so the UI can map
/// porcelain paths (repo-relative) onto a tree opened at a subfolder.
#[tauri::command]
pub async fn git_repo_root(root: String) -> Result<Option<String>, String> {
    crate::blocking(move || find_repo(Path::new(&root)).map(|p| p.to_string_lossy().into_owned()))
        .await
}
