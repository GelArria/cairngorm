use portable_pty::CommandBuilder;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::Manager;

use crate::session_resume::{
    agent_args_start, quote, resume, resume_args, valid_id, Report, AGENTS,
};

#[path = "session_snapshot.rs"]
mod snapshot;
pub(crate) use snapshot::{busy_panes, capture};

static OWNERS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

pub fn release(id: &str) {
    if let Some(owners) = OWNERS.get() {
        owners.lock().unwrap().retain(|_, owner| owner != id);
    }
}

fn claim(report: &Report, id: &str) -> bool {
    let reference = if report.agent == "pi" {
        report.path.as_deref().unwrap_or(&report.id)
    } else {
        &report.id
    };
    let key = format!("{}:{}", report.agent, reference);
    let mut owners = OWNERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap();
    if owners.get(&key).is_some_and(|owner| owner != id) {
        return false;
    }
    owners.insert(key, id.to_string());
    true
}

pub fn report_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid terminal identity".into());
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("terminal-sessions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{id}.json")))
}

/// Reuse the executable only when it still names the reported agent. Historical launch
/// options (including permission modes and prompts) must not override the current session.
fn profile_resume(shell: &str, args: &[String], report: &Report) -> Option<Vec<String>> {
    let (command, groups) = resume_args(report)?;
    let cli = crate::launch_profiles::profile_cli(shell, args)?;
    let start = agent_args_start(command, &cli)?;
    let current: Vec<String> = cli.args[..start]
        .iter()
        .cloned()
        .chain(groups.into_iter().flatten())
        .collect();
    crate::launch_profiles::with_cli_args(shell, args, &current)
}

fn restores(shell: &str, args: &[String], report: &Report) -> bool {
    profile_resume(shell, args, report).is_some()
        || (base_launch(shell, args, false)
            .is_some_and(|(host, _)| shell_resumes(&host, &report.agent))
            && resume(report, true).is_some())
}

/// Only these hosts receive a resume command; other programs launch unchanged.
fn shell_resumes(shell: &str, agent: &str) -> bool {
    let name = Path::new(shell)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    matches!(
        name.as_str(),
        "powershell" | "pwsh" | "bash" | "zsh" | "sh" | "fish"
    ) || (name == "cmd" && agent != "pi")
}

/// Remove a known agent launch, not an arbitrary explicit user command.
fn base_launch(shell: &str, args: &[String], closed: bool) -> Option<(String, Vec<String>)> {
    let cli = crate::launch_profiles::profile_cli(shell, args)?;
    let command: Vec<_> = std::iter::once(cli.program.clone())
        .chain(cli.args.iter().cloned())
        .collect();
    let agent = crate::plugins::agent_of_process(&cli.program, &cli.program, &command).is_some();
    if agent || closed {
        if let Some(args) = crate::launch_profiles::host_args(shell, args) {
            return Some((shell.to_string(), args));
        }
        if agent {
            // A direct agent has no hosting shell to return to.
            return Some(if cfg!(windows) {
                ("powershell.exe".into(), vec![])
            } else {
                (
                    std::env::var("SHELL")
                        .ok()
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "/bin/sh".into()),
                    vec![],
                )
            });
        }
    }
    (!has_explicit_command(args) && shell_resumes(shell, "shell"))
        .then(|| (shell.to_string(), args.to_vec()))
}

/// Rebuild a shell, optionally running its exact native conversation first.
/// Live ensure returns before here: remount/detach never launches a duplicate agent.
pub fn command(
    app: &tauri::AppHandle,
    id: &str,
    shell: &str,
    args: Vec<String>,
    cwd: Option<String>,
    is_agent: bool,
) -> Result<CommandBuilder, String> {
    let file = report_path(app, id)?;
    let mut report = std::fs::metadata(&file)
        .ok()
        .filter(|m| m.len() <= 8192)
        .and_then(|_| std::fs::read_to_string(&file).ok())
        .and_then(|s| serde_json::from_str::<Report>(&s).ok());
    // Same conversation in two saved panes must not launch two competing clients.
    if let Some(r) = report
        .as_ref()
        .filter(|r| !is_agent && restores(shell, &args, r))
    {
        if !claim(r, id) {
            // A duplicate must return to its shell, not replay the original agent launch.
            if let Some(report) = report.as_mut() {
                report.agent = "shell".into();
            }
        }
    }
    let mut cmd = build_command(
        shell,
        args,
        cwd,
        if is_agent { None } else { report.as_ref() },
    );
    cmd.env("CAIRNGORM_SESSION_REPORT", file);
    Ok(cmd)
}

fn build_command(
    shell: &str,
    args: Vec<String>,
    cwd: Option<String>,
    report: Option<&Report>,
) -> CommandBuilder {
    // An unused conversation may relaunch its original agent, never a different historical CLI.
    let report = report.filter(|r| {
        !crate::session_resume::unsaved(r)
            || !crate::launch_profiles::profile_cli(shell, &args).is_some_and(|cli| {
                AGENTS.iter().any(|(agent, command, ..)| {
                    *agent == r.agent && agent_args_start(command, &cli).is_some()
                })
            })
    });
    let base = report
        .filter(|r| {
            let unsupported_replaced_known_agent = r.agent == "unreported"
                && crate::launch_profiles::profile_cli(shell, &args).is_some_and(|cli| {
                    AGENTS
                        .iter()
                        .any(|(_, command, ..)| agent_args_start(command, &cli).is_some())
                });
            valid_id(&r.id)
                && (r.agent == "shell"
                    || AGENTS.iter().any(|(a, ..)| *a == r.agent)
                    || unsupported_replaced_known_agent)
        })
        .and_then(|r| {
            base_launch(
                shell,
                &args,
                matches!(r.agent.as_str(), "shell" | "unreported"),
            )
        });
    let profile = report.and_then(|r| profile_resume(shell, &args, r));
    let (shell, args) = if profile.is_none() {
        base.unwrap_or_else(|| (shell.to_string(), args))
    } else {
        (shell.to_string(), args)
    };
    let name = Path::new(&shell)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let powershell = name == "powershell" || name == "pwsh";
    let mut cmd = CommandBuilder::new(&shell);
    if let Some(dir) = cwd.as_deref() {
        cmd.cwd(dir);
    }
    if let Some((report, profile)) = report.zip(profile) {
        cmd.args(&profile);
        if let Some(dir) = report.cwd.as_deref().filter(|dir| Path::new(dir).is_dir()) {
            cmd.cwd(dir);
        }
        return cmd;
    }
    cmd.args(&args);
    if let Some(report) = report.filter(|_| !has_explicit_command(&args)) {
        if let Some(command) = resume(report, powershell) {
            if let Some(dir) = report.cwd.as_deref().filter(|dir| Path::new(dir).is_dir()) {
                cmd.cwd(dir);
            }
            if powershell {
                cmd.args(["-NoExit", "-Command", &command]);
            } else if ["bash", "zsh", "sh", "fish"].contains(&name.as_str()) {
                let restart = std::iter::once(shell.to_string())
                    .chain(args)
                    .map(|s| quote(&s, false))
                    .collect::<Vec<_>>()
                    .join(" ");
                cmd.args(["-c", &format!("{command}; exec {restart}")]);
            } else if name == "cmd" && report.agent != "pi" {
                // IDs contain no cmd metacharacters; single quotes aren't quoting in cmd.exe.
                cmd.args(["/K", &command.replace('\'', "")]);
            }
        }
    }
    cmd
}

// Arbitrary explicit scripts are authoritative; only our recognized agent wrappers are replaced.
fn has_explicit_command(args: &[String]) -> bool {
    args.iter().any(|arg| {
        matches!(
            arg.to_ascii_lowercase().as_str(),
            "-encodedcommand" | "-command" | "-commandwithargs" | "-file" | "-c" | "/c" | "/k"
        )
    })
}

#[cfg(test)]
#[path = "../../../tests/native/session-report.rs"]
mod tests;

#[cfg(test)]
#[path = "../../../tests/native/session-report-profile.rs"]
mod profile_tests;

#[cfg(test)]
#[path = "../../../tests/native/session-restore-state.rs"]
mod restore_state_tests;
