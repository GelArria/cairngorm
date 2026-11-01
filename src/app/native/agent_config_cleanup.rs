//! "Remove Cairngorm from agent configs": session hooks, session plugins, the Claude Code
//! status line relay (integrations) and the MCP bridge entries (plugins). Settings runs it on
//! request; the Windows uninstaller runs the same cleanup through a command-line flag.
use crate::{agent_cleanup, agent_integrations, ai_cli, claude_statusline, plugins};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, WebviewWindow};

/// The flag the uninstaller passes; the process cleans up and exits without a window.
pub const UNINSTALL_FLAG: &str = "--remove-agent-integrations";
/// Must match `identifier` in tauri.conf.json: the app data folder is named after it.
const IDENTIFIER: &str = "com.panelnative.app";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCleanupReport {
    /// Configurations that could not be cleaned, with the reason; empty means all done.
    errors: Vec<String>,
    removed: bool,
}

fn remove_all(home: &Path, plugins_dir: &Path) -> Vec<String> {
    let mut results = agent_cleanup::remove(home, &claude_statusline::claude_dirs());
    results.extend(plugins::disconnect_agents(plugins_dir));
    results.into_iter().filter_map(Result::err).collect()
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main app window can change agent configurations.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_configs_remove(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<AgentCleanupReport, String> {
    require_main(&window)?;
    crate::blocking(move || {
        let home = ai_cli::home();
        // Recorded first, so a terminal opened meanwhile does not add the hooks back.
        agent_cleanup::set_removed(&home, true)?;
        let errors = remove_all(&home, &plugins::app_plugins_dir(&app)?);
        Ok(AgentCleanupReport {
            errors,
            removed: true,
        })
    })
    .await?
}

/// Adds the session hooks and status line relay back now. The MCP bridge returns only through
/// Settings ▸ Plugins ▸ Connect agents, which asks for its own consent.
#[tauri::command]
pub async fn agent_configs_restore(window: WebviewWindow) -> Result<AgentCleanupReport, String> {
    require_main(&window)?;
    crate::blocking(move || {
        let home = ai_cli::home();
        agent_cleanup::set_removed(&home, false)?;
        let mut errors: Vec<String> = agent_integrations::install(&home)
            .into_iter()
            .filter_map(Result::err)
            .collect();
        // Same guard as startup: a relay without a working python3 would blank the status line.
        let relay_runs = cfg!(windows) || claude_statusline::python_available();
        for dir in claude_statusline::claude_dirs()
            .iter()
            .filter(|d| relay_runs && d.is_dir())
        {
            if let Err(error) = claude_statusline::install(dir) {
                errors.push(error);
            }
        }
        Ok(AgentCleanupReport {
            errors,
            removed: false,
        })
    })
    .await?
}

#[tauri::command]
pub async fn agent_configs_removed() -> Result<bool, String> {
    Ok(agent_cleanup::removed(&ai_cli::home()))
}

/// The plugins folder without a running app: `<roaming app data>/<identifier>/plugins`.
fn uninstaller_plugins_dir() -> Option<PathBuf> {
    let data = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        Some(ai_cli::home().join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| Some(ai_cli::home().join(".local/share")))
    }?;
    Some(data.join(IDENTIFIER).join("plugins"))
}

/// Runs the cleanup when the uninstaller started this process; true means exit now.
/// It does not leave the "removed" marker: a later reinstall starts as a fresh install.
pub fn run_from_uninstaller() -> bool {
    if !std::env::args().skip(1).any(|arg| arg == UNINSTALL_FLAG) {
        return false;
    }
    let home = ai_cli::home();
    if home.as_os_str().is_empty() {
        return true;
    }
    let errors = match uninstaller_plugins_dir() {
        Some(dir) => remove_all(&home, &dir),
        None => agent_cleanup::remove(&home, &claude_statusline::claude_dirs())
            .into_iter()
            .filter_map(Result::err)
            .collect(),
    };
    for error in errors {
        eprintln!("[cairngorm uninstall] {error}");
    }
    true
}

#[cfg(test)]
mod tests {
    #[test]
    fn identifier_matches_the_tauri_config() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../../src-tauri/tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], super::IDENTIFIER);
    }
}
