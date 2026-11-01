//! Gemini CLI has no flag to ignore user or workspace settings, so each Cairngorm run gets an
//! admin-tier tool policy, which outranks user and workspace rules, and, when the machine has
//! no system settings of its own, a system settings file that turns hooks off.
use std::path::{Path, PathBuf};

/// Reading and editing inside the workspace; Gemini CLI's file tools refuse other paths.
const READ_AND_EDIT: &str = r#"["list_directory", "read_file", "read_many_files", "glob", "grep_search", "search_file_content", "replace", "write_file", "write_todos", "activate_skill", "update_topic"]"#;

const SYSTEM_SETTINGS: &str = "{ \"hooksConfig\": { \"enabled\": false } }\n";

/// Every tool is denied, so shell, web, MCP and discovered tools never reach the model;
/// agent sessions then get the read and edit tools back at a higher priority.
pub(crate) fn policy(edits: bool) -> String {
    let mut text = String::from(
        "# Managed by Cairngorm for its own Gemini CLI runs.\n[[rule]]\ntoolName = \"*\"\ndecision = \"deny\"\npriority = 0\ndenyMessage = \"Cairngorm runs Gemini CLI without shell, web or MCP tools.\"\n",
    );
    if edits {
        text.push_str(&format!(
            "\n[[rule]]\ntoolName = {READ_AND_EDIT}\ndecision = \"allow\"\npriority = 500\n"
        ));
    }
    text
}

pub(crate) fn dir() -> PathBuf {
    crate::ai_cli::home().join(".panel/agent/gemini")
}

/// Gemini CLI's own system settings location; one that exists belongs to the machine.
fn default_system_settings() -> PathBuf {
    if cfg!(windows) {
        std::env::var_os("ProgramData")
            .map_or_else(|| PathBuf::from(r"C:\ProgramData"), PathBuf::from)
            .join(r"gemini-cli\settings.json")
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/GeminiCli/settings.json")
    } else {
        PathBuf::from("/etc/gemini-cli/settings.json")
    }
}

fn write_if_changed(path: &Path, text: &str) -> Result<(), String> {
    if std::fs::read_to_string(path).ok().as_deref() == Some(text) {
        return Ok(());
    }
    std::fs::create_dir_all(path.parent().ok_or("Invalid Gemini CLI policy folder.")?)
        .and_then(|_| std::fs::write(path, text))
        .map_err(|_| "Could not prepare the Gemini CLI tool policy.".into())
}

pub(crate) struct Isolation {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// An existing system settings file or a central admin policy folder takes precedence:
/// Gemini CLI then keeps that machine's rules instead of these.
pub(crate) fn prepare(dir: &Path, edits: bool) -> Result<Isolation, String> {
    let policy_file = dir.join(if edits {
        "agent-policy.toml"
    } else {
        "draft-policy.toml"
    });
    write_if_changed(&policy_file, &policy(edits))?;
    let mut env = Vec::new();
    if std::env::var_os("GEMINI_CLI_SYSTEM_SETTINGS_PATH").is_none()
        && !default_system_settings().exists()
    {
        let settings = dir.join("system-settings.json");
        write_if_changed(&settings, SYSTEM_SETTINGS)?;
        env.push((
            "GEMINI_CLI_SYSTEM_SETTINGS_PATH".into(),
            settings.to_string_lossy().into_owned(),
        ));
    }
    Ok(Isolation {
        args: vec![
            "--admin-policy".into(),
            policy_file.to_string_lossy().into_owned(),
        ],
        env,
    })
}
