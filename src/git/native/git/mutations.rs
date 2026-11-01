use super::{git, repo, report_after, report_blocking, serial, GitReport};
use std::path::Path;
#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>, all: bool) -> GitReport {
    report_blocking(move || {
        serial(|| {
            let repo = match repo(&root) {
                Ok(r) => r,
                Err(e) => return e,
            };
            let mut args: Vec<String> = vec!["add".into()];
            if all {
                args.push("-A".into());
            } else {
                args.push("--".into());
                args.extend(paths);
            }
            if let Err(e) = git(&repo, &args.iter().map(|s| s.as_str()).collect::<Vec<_>>()) {
                return GitReport {
                    files: vec![],
                    error: Some(e),
                };
            }
            report_after(&root)
        })
    })
    .await
}

#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>, all: bool) -> GitReport {
    report_blocking(move || {
        serial(|| {
            let repo = match repo(&root) {
                Ok(r) => r,
                Err(e) => return e,
            };
            let mut args: Vec<String> = vec!["reset".into(), "-q".into()];
            if !all {
                args.push("--".into());
                args.extend(paths);
            }
            if let Err(e) = git(&repo, &args.iter().map(|s| s.as_str()).collect::<Vec<_>>()) {
                return GitReport {
                    files: vec![],
                    error: Some(e),
                };
            }
            report_after(&root)
        })
    })
    .await
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitOptions {
    pub amend: bool,
    pub signoff: bool,
    pub skip_hooks: bool,
}

#[tauri::command]
pub async fn git_commit(
    root: String,
    message: String,
    mode: Option<String>,
    options: Option<CommitOptions>,
) -> GitReport {
    report_blocking(move || {
        serial(|| {
            let repo = match repo(&root) {
                Ok(r) => r,
                Err(e) => return e,
            };
            if message.trim().is_empty() {
                return GitReport {
                    files: vec![],
                    error: Some("Empty commit message".into()),
                };
            }
            let options = options.unwrap_or_default();
            if options.amend && git(&repo, &["rev-parse", "--verify", "HEAD"]).is_err() {
                return GitReport {
                    files: vec![],
                    error: Some("No commit to amend".into()),
                };
            }
            let mode = mode.as_deref().unwrap_or("staged");
            if !matches!(mode, "staged" | "tracked" | "all") {
                return GitReport {
                    files: vec![],
                    error: Some("Unknown commit mode".into()),
                };
            }
            if mode == "all" {
                if let Err(e) = git(&repo, &["add", "-A"]) {
                    let mut report = report_after(&root);
                    report.error = Some(e);
                    return report;
                }
            }
            let mut git_args = vec!["commit", "-q", "-m", message.as_str()];
            if mode == "tracked" {
                git_args.push("-a");
            }
            if options.amend {
                git_args.push("--amend");
            }
            if options.signoff {
                git_args.push("--signoff");
            }
            if options.skip_hooks {
                git_args.push("--no-verify");
            }
            if let Err(e) = git(&repo, &git_args) {
                let mut report = report_after(&root);
                report.error = Some(e);
                return report;
            }
            report_after(&root)
        })
    })
    .await
}

/// `git init` in the project folder (Git panel's "Initialize repository").
#[tauri::command]
pub async fn git_init(root: String) -> GitReport {
    report_blocking(move || {
        serial(|| {
            if let Err(e) = git(Path::new(&root), &["init", "-q"]) {
                return GitReport {
                    files: vec![],
                    error: Some(e),
                };
            }
            report_after(&root)
        })
    })
    .await
}

#[tauri::command]
pub async fn git_branch(root: String) -> Result<String, String> {
    crate::blocking(move || {
        let repo = repo(&root).map_err(|_| "no-repo".to_string())?;
        Ok(git(&repo, &["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string())
    })
    .await?
}
