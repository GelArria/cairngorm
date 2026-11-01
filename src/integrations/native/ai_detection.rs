use crate::{ai_cli, ai_runtime::AiRuntime};
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiService {
    id: String,
    pub name: String,
    cli_path: Option<String>,
    home_path: String,
    local_setup: bool,
    pub status: String,
    pub auth_kind: Option<String>,
    pub message: String,
    /// A detected CLI login, shown for information only. Whether Cairngorm may use the
    /// service is decided by `status`, never by this.
    pub login: Option<CliLogin>,
    runtime: AiRuntime,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliLogin {
    /// Plan name as the CLI reports it, e.g. "pro" or "max".
    pub plan: Option<String>,
    /// A consumer subscription login rather than an API key or custom provider.
    pub subscription: bool,
}

/// Claude Code's own login, from `claude auth status --json` (no model request). Display
/// only: Cairngorm never runs requests through a Claude subscription.
fn claude_login(cli: &std::path::Path, runtime: &AiRuntime) -> Option<CliLogin> {
    let mut command = ai_cli::command(cli).ok()?;
    runtime.apply(&mut command, "claude").ok()?;
    command
        .current_dir(std::env::temp_dir())
        .args(["auth", "status", "--json"]);
    let (ok, stdout, _) = ai_cli::run(command, None, Duration::from_secs(12)).ok()?;
    parse_claude_login(ok, &stdout)
}

/// The `auth status --json` document, even when update notices or warnings surround it.
fn claude_status(stdout: &str) -> Option<serde_json::Value> {
    stdout.match_indices('{').find_map(|(at, _)| {
        let value: serde_json::Value = serde_json::Deserializer::from_str(&stdout[at..])
            .into_iter()
            .next()?
            .ok()?;
        value.get("loggedIn").is_some().then_some(value)
    })
}

/// A Claude subscription login: claude.ai sign-in, or a `claude setup-token` token in
/// CLAUDE_CODE_OAUTH_TOKEN. API keys, key helpers and cloud providers are not. Claude
/// also reports gateway bearer tokens as "oauth_token", so those need no gateway set.
pub(crate) fn claude_login_is_subscription(body: &serde_json::Value, gateway: bool) -> bool {
    match body["authMethod"].as_str() {
        Some("claude.ai") => true,
        Some("oauth_token") => !gateway,
        _ => false,
    }
}

fn claude_subscription(body: &serde_json::Value) -> bool {
    let set = |name| std::env::var_os(name).is_some_and(|value| !value.is_empty());
    claude_login_is_subscription(
        body,
        set("ANTHROPIC_AUTH_TOKEN") || set("ANTHROPIC_BASE_URL"),
    )
}

pub(crate) fn parse_claude_login(ok: bool, stdout: &str) -> Option<CliLogin> {
    let body = claude_status(stdout)?;
    if !ok || body["loggedIn"] != true {
        return None;
    }
    Some(CliLogin {
        plan: body["subscriptionType"]
            .as_str()
            .filter(|plan| !plan.is_empty())
            .map(String::from),
        subscription: claude_subscription(&body),
    })
}

// Auth-status metadata only: never read auth.json, credentials or keychains.
pub(crate) fn auth_status(
    id: &str,
    ok: bool,
    stdout: &str,
    stderr: &str,
) -> (String, Option<String>, String) {
    if id == "claude" {
        if let Some(body) = claude_status(stdout) {
            if body["loggedIn"] == true && ok {
                let kind = if claude_subscription(&body) {
                    "subscription"
                } else {
                    "api-or-custom"
                };
                return (
                    "session-detected".into(),
                    Some(kind.into()),
                    "Existing login found. Verify access before using it.".into(),
                );
            }
            if body["loggedIn"] == false {
                return ("signed-out".into(), None, "Sign in with the official CLI using this configuration folder, then scan again.".into());
            }
        }
    } else {
        let status = format!("{stdout}\n{stderr}").to_lowercase();
        // Newer Codex reports an API key as "API key configured - sk-…"; older releases
        // said "Logged in using an API key". Access tokens and Bedrock are not ChatGPT plans.
        if ok && (status.contains("logged in using") || status.contains("api key configured -")) {
            let kind = if status.contains("logged in using chatgpt") {
                "subscription"
            } else {
                "api-or-custom"
            };
            return (
                "session-detected".into(),
                Some(kind.into()),
                "Existing login found. Verify access before using it.".into(),
            );
        }
        if status.contains("not logged in") {
            return (
                "signed-out".into(),
                None,
                "Sign in with the official CLI using this configuration folder, then scan again."
                    .into(),
            );
        }
        if status.contains("error loading configuration") || status.contains("error parsing -c") {
            return (
                "check-failed".into(),
                None,
                "Codex could not read its configuration. Fix config.toml in this configuration folder, then scan again."
                    .into(),
            );
        }
    }
    (
        "check-failed".into(),
        None,
        "Could not check login. Check the binary path or update the CLI, then scan again.".into(),
    )
}

pub(crate) fn detect(id: &str, runtime: AiRuntime) -> AiService {
    let name = match id {
        "codex" => "Codex",
        "gemini" => "Gemini CLI",
        _ => "Claude Code",
    };
    let local = runtime.config_home(id).unwrap_or_default();
    let resolved = runtime.resolve(id);
    let mut path = None;
    let mut login = None;
    let (status, auth_kind, message) = match resolved {
        Ok(Some(cli)) => {
            path = Some(cli.clone());
            if id == "claude" {
                login = claude_login(&cli, &runtime);
                let available = crate::claude_api::key_available();
                (if available { "session-detected" } else { "api-key-required" }.into(),
                    available.then(|| "api-or-custom".into()),
                    if available { "API key found. Verification incurs Anthropic API charges and requires typed consent." }
                    else { "Automatic integration requires ANTHROPIC_API_KEY, not a Free, Pro or Max login. Manual terminal use is unchanged." }.into())
            } else if id == "gemini" {
                // Gemini CLI has no login-status command; it must at least start.
                let runs = (|| {
                    let mut command = ai_cli::command(&cli)?;
                    runtime.apply(&mut command, id)?;
                    command.current_dir(std::env::temp_dir()).arg("--version");
                    ai_cli::run(command, None, Duration::from_secs(12))
                })();
                match runs {
                    Ok((true, _, _)) => crate::ai_gemini::read_auth_status(&local),
                    _ => ("check-failed".into(), None, "CLI did not answer. Check its binary path and installation, then scan again.".into()),
                }
            } else {
                let result = (|| {
                    let mut command = ai_cli::command(&cli)?;
                    runtime.apply(&mut command, id)?;
                    command.current_dir(std::env::temp_dir()).args(["login", "status"]);
                    ai_cli::run(command, None, Duration::from_secs(12))
                })();
                match result {
                    Ok((ok, out, err)) => auth_status(id, ok, &out, &err),
                    Err(_) => ("check-failed".into(), None, "CLI did not answer. Check its binary path and installation, then scan again.".into()),
                }
            }
        }
        Ok(None) => ("not-installed".into(), None, if local.is_dir() {
            "Local setup found, but no runnable CLI. Set its binary path; a desktop login alone cannot be verified here."
        } else { "CLI not found. Set its binary path or install the official CLI." }.into()),
        Err(error) => ("check-failed".into(), None, error),
    };
    AiService {
        id: id.into(),
        name: name.into(),
        cli_path: path.map(|p| p.to_string_lossy().into_owned()),
        home_path: local.to_string_lossy().into_owned(),
        local_setup: local.is_dir(),
        // Codex and Gemini CLI: the checked login doubles as the displayed one.
        login: login.or_else(|| {
            (id != "claude" && status == "session-detected").then(|| CliLogin {
                plan: None,
                subscription: auth_kind.as_deref() == Some("subscription"),
            })
        }),
        status,
        auth_kind,
        message,
        runtime,
    }
}
