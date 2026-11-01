// Gemini CLI as a subscription provider. Like Codex, Cairngorm only runs the official CLI,
// which keeps its own Google login: never read its OAuth files or keychain entries.
use std::path::{Path, PathBuf};

/// npm entry scripts, newest layout first; older releases shipped `dist/index.js`.
pub(crate) const NPM_ENTRIES: &[&str] = &[
    "node_modules/@google/gemini-cli/bundle/gemini.js",
    "node_modules/@google/gemini-cli/dist/index.js",
];

/// A name no MCP server has: Gemini CLI then starts none of the user's servers.
const NO_MCP: &str = "cairngorm-no-mcp";

pub(crate) const USAGE_NOTE: &str =
    "Gemini CLI shows remaining quota with /stats model in a terminal. Google does not share it with other apps.";

/// The `.gemini` folder for a folder the user chose: either that folder itself or the
/// `GEMINI_CLI_HOME` root that contains it.
pub(crate) fn config_folder(chosen: PathBuf) -> PathBuf {
    if chosen.file_name().is_some_and(|name| name == ".gemini") {
        chosen
    } else {
        chosen.join(".gemini")
    }
}

/// `GEMINI_CLI_HOME` for a `.gemini` folder: the folder that contains it.
pub(crate) fn cli_home(config: &Path) -> PathBuf {
    config
        .parent()
        .map_or_else(|| config.to_path_buf(), Path::to_path_buf)
}

/// Settings flags shared by every Cairngorm run: no extensions and no MCP servers.
fn isolated() -> [&'static str; 4] {
    ["--extensions", "none", "--allowed-mcp-server-names", NO_MCP]
}

/// One-shot drafts. The tool policy from `ai_gemini_isolation` denies every tool.
pub(crate) fn draft_args() -> Vec<String> {
    let mut args = vec![
        "--output-format",
        "json",
        "--approval-mode",
        "default",
        // A fresh, empty temporary folder holds nothing to trust.
        "--skip-trust",
    ];
    args.extend(isolated());
    args.into_iter().map(String::from).collect()
}

/// Agent sessions may read and edit the workspace; the tool policy from
/// `ai_gemini_isolation` denies shell, web and every other tool.
pub(crate) fn agent_args() -> Vec<String> {
    let mut args = vec!["--approval-mode", "auto_edit"];
    args.extend(isolated());
    args.into_iter().map(String::from).collect()
}

pub(crate) fn parse_draft(output: &str) -> Result<String, String> {
    // Warnings can surround the JSON document on stdout: take the first object that is a
    // Gemini CLI result.
    let body = output
        .match_indices('{')
        .filter_map(|(at, _)| {
            serde_json::Deserializer::from_str(&output[at..])
                .into_iter::<serde_json::Value>()
                .next()?
                .ok()
        })
        .find(|value| value.get("response").is_some() || value.get("error").is_some())
        .ok_or("Unsupported Gemini CLI response. Update the CLI.")?;
    if !body["error"].is_null() {
        return Err(request_error(&body["error"].to_string()));
    }
    Ok(body["response"].as_str().unwrap_or("").to_string())
}

pub(crate) fn request_error(output: &str) -> String {
    let lower = output.to_lowercase();
    if ["quota", "exhausted", "usage limit", "rate limit"]
        .iter()
        .any(|word| lower.contains(word))
    {
        "Gemini usage limit reached. Wait for your quota to reset, check your Google AI plan or choose another provider in AI providers.".into()
    } else {
        "Gemini CLI request failed. Check your login, CLI version and quota in Settings → AI providers."
            .into()
    }
}

/// `security.auth.selectedType` from a settings file, which may contain comments. Settings
/// written before Gemini CLI's v2 layout keep it as top-level `selectedAuthType`.
pub(crate) fn selected_auth(settings: &str) -> Option<String> {
    let settings: String = settings
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    ["\"selectedType\"", "\"selectedAuthType\""]
        .iter()
        .find_map(|key| {
            let at = settings.find(key)? + key.len();
            let rest = settings[at..].trim_start().strip_prefix(':')?.trim_start();
            let value = rest.strip_prefix('"')?;
            Some(value[..value.find('"')?].to_string())
        })
}

/// The auth method Gemini CLI picks from the environment when settings name none.
pub(crate) fn env_auth(var: impl Fn(&str) -> Option<String>) -> Option<&'static str> {
    let set = |name: &str| var(name).is_some_and(|v| !v.trim().is_empty());
    // Gemini CLI compares with exactly "true".
    let enabled = |name: &str| var(name).is_some_and(|v| v == "true");
    if enabled("GOOGLE_GENAI_USE_GCA") {
        Some("oauth-personal")
    } else if enabled("GOOGLE_GENAI_USE_VERTEXAI") {
        Some("vertex-ai")
    } else if set("GEMINI_API_KEY") || set("GOOGLE_API_KEY") {
        Some("gemini-api-key")
    } else {
        None
    }
}

/// Login state from the auth method Gemini CLI saved after signing in, or else the one the
/// environment selects; the verification request in AI providers proves it still works.
pub(crate) fn auth_status(
    settings: Option<&str>,
    env_auth: Option<&str>,
) -> (String, Option<String>, String) {
    let detected = |kind: &str| {
        (
            "session-detected".to_string(),
            Some(kind.to_string()),
            "Existing login found. Verify access before using it.".to_string(),
        )
    };
    match settings.and_then(selected_auth).as_deref().or(env_auth) {
        Some("oauth-personal") => detected("subscription"),
        Some(_) => detected("api-or-custom"),
        None => (
            "signed-out".into(),
            None,
            "Sign in with the official CLI using this configuration folder, then scan again."
                .into(),
        ),
    }
}

/// Reads only `settings.json`, never the credential files beside it.
pub(crate) fn read_auth_status(config: &Path) -> (String, Option<String>, String) {
    let settings = std::fs::read_to_string(config.join("settings.json")).ok();
    auth_status(
        settings.as_deref(),
        env_auth(|name| std::env::var(name).ok()),
    )
}
