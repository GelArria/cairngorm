use crate::ai_cli;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AiRuntime {
    pub binary_path: String,
    pub home_path: String,
}

pub(crate) fn env_name(id: &str) -> &'static str {
    match id {
        "codex" => "CODEX_HOME",
        "gemini" => "GEMINI_CLI_HOME",
        _ => "CLAUDE_CONFIG_DIR",
    }
}

fn absolute(value: &str) -> Result<PathBuf, String> {
    let path = if value == "~" {
        ai_cli::home()
    } else if value.starts_with("~/") || value.starts_with("~\\") {
        ai_cli::home().join(&value[2..])
    } else {
        PathBuf::from(value)
    };
    if !path.is_absolute() {
        return Err("Use an absolute path or ~/ for the configuration folder.".into());
    }
    Ok(path)
}

impl AiRuntime {
    pub(crate) fn config_home(&self, id: &str) -> Result<PathBuf, String> {
        let home = crate::cli_paths::normalize(&self.home_path)?;
        if id == "gemini" {
            // GEMINI_CLI_HOME names the folder that contains `.gemini`.
            return Ok(if home.is_empty() {
                crate::agent_integrations::gemini_dir(
                    &ai_cli::home(),
                    &crate::agent_integrations::real_env,
                )
            } else {
                crate::ai_gemini::config_folder(absolute(&home)?)
            });
        }
        if !home.is_empty() {
            return absolute(&home);
        }
        Ok(std::env::var_os(env_name(id))
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                ai_cli::home().join(if id == "codex" { ".codex" } else { ".claude" })
            }))
    }

    pub(crate) fn resolve(&self, id: &str) -> Result<Option<PathBuf>, String> {
        if !matches!(id, "codex" | "claude" | "gemini") {
            return Err("Unknown AI integration.".into());
        }
        let normalized = crate::cli_paths::normalize(&self.binary_path)?;
        if normalized.is_empty() {
            return Ok(ai_cli::resolve(id));
        }
        let value = &normalized;
        let path = if Path::new(value).is_absolute()
            || value.starts_with("~/")
            || value.starts_with("~\\")
        {
            absolute(value)?
        } else if value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        {
            crate::cli_paths::find(value)
                .ok_or("CLI command not found on PATH. Use its full executable path.")?
        } else {
            return Err(
                "Use an executable path or command name, not a shell command or arguments.".into(),
            );
        };
        if !path.is_file() {
            return Err("CLI executable not found at this path.".into());
        }
        // npm wrappers are resolved without evaluating shell content.
        if crate::cli_paths::is_launcher(&path) {
            let Some(script) = crate::cli_paths::launcher_script(&path, ai_cli::npm_entries(id))
            else {
                return Err(
                    "Unsupported shell launcher. Select the CLI executable instead.".into(),
                );
            };
            ai_cli::command(&script)?;
            return Ok(Some(script));
        }
        if crate::cli_paths::is_node_entry(&path) {
            ai_cli::command(&path)?;
        } else {
            #[cfg(windows)]
            {
                use std::os::windows::ffi::OsStrExt;
                #[link(name = "kernel32")]
                extern "system" {
                    fn GetBinaryTypeW(path: *const u16, kind: *mut u32) -> i32;
                }
                let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                let mut kind = 0;
                if unsafe { GetBinaryTypeW(wide.as_ptr(), &mut kind) } == 0
                    || !matches!(kind, 0 | 6)
                {
                    return Err("Selected file is not an executable CLI.".into());
                }
            }
            #[cfg(not(windows))]
            if which::which(&path).is_err() {
                return Err("Selected file is not an executable CLI.".into());
            }
        }
        Ok(Some(path))
    }

    pub(crate) fn validate(&mut self, id: &str) -> Result<(), String> {
        self.binary_path = crate::cli_paths::normalize(&self.binary_path)?;
        self.home_path = crate::cli_paths::normalize(&self.home_path)?;
        self.resolve(id)?;
        if !self.home_path.is_empty() && !self.config_home(id)?.is_dir() {
            return Err(
                "Configuration folder not found. Select the existing provider folder.".into(),
            );
        }
        Ok(())
    }

    pub(crate) fn apply(&self, command: &mut Command, id: &str) -> Result<(), String> {
        if id == "gemini" {
            // Always set: an inherited relative value would differ from the folder shown.
            let home = crate::ai_gemini::cli_home(&self.config_home(id)?);
            command.env(env_name(id), home);
        } else if !self.home_path.is_empty() {
            command.env(env_name(id), self.config_home(id)?);
        }
        Ok(())
    }
}
