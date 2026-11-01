use crate::ai_runtime::AiRuntime;
use serde::{Deserialize, Serialize};
use std::process::Command;

const VERSION: u32 = 1;
pub(crate) const CONSENT_REQUIRED: &str = "Claude Code API billing consent required. Open Settings → AI providers and type I understand before verification or use.";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeApiConsent {
    version: u32,
    runtime: AiRuntime,
}
impl ClaudeApiConsent {
    pub(crate) fn new(runtime: &AiRuntime) -> Self {
        Self {
            version: VERSION,
            runtime: runtime.clone(),
        }
    }
    pub(crate) fn matches(&self, runtime: &AiRuntime) -> bool {
        self.version == VERSION && &self.runtime == runtime
    }
}

pub(crate) fn key_available() -> bool {
    std::env::var("ANTHROPIC_API_KEY").is_ok_and(|key| !key.trim().is_empty())
}

pub(crate) fn authorize(runtime: &AiRuntime, acknowledgement: Option<&str>) -> Result<(), String> {
    let granted = match acknowledgement {
        Some(text) => text == "I understand",
        None => crate::ai_integrations::read_config()?
            .claude_api_consent
            .is_some_and(|consent| consent.matches(runtime)),
    };
    if !granted {
        return Err(CONSENT_REQUIRED.into());
    }
    if !key_available() {
        return Err("Automatic Claude integration requires ANTHROPIC_API_KEY. Claude Free, Pro and Max logins cannot be used here; manual terminal use is unchanged.".into());
    }
    Ok(())
}

/// Bare mode plus a bounded environment prevents subscription, gateway and cloud-provider overrides.
pub(crate) fn apply(command: &mut Command) -> Result<(), String> {
    let key = std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty())
        .ok_or("ANTHROPIC_API_KEY is required for automatic Claude integration.")?;
    command.env_clear();
    for name in [
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "PATH",
        "PATHEXT",
        "TEMP",
        "TMP",
        "TMPDIR",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMFILES",
        "PROGRAMFILES(X86)",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "https_proxy",
        "http_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        // Keep the folders `ai_cli::command` added for apps opened outside a shell.
        .env("PATH", crate::cli_paths::search_path())
        .env("ANTHROPIC_API_KEY", key)
        .env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/native/claude-api.rs"]
mod tests;
