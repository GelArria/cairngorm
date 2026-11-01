use crate::{agent_config, agent_env, ai_cli, ai_integrations};
use std::collections::BTreeMap;

#[tauri::command]
pub async fn ai_summary_setup_required() -> Result<bool, String> {
    crate::blocking(|| {
        if ai_integrations::claude_consent_required(&ai_integrations::read_config()?) {
            return Ok(true);
        }
        if ai_integrations::selected_cli()?.is_some() {
            return Ok(false);
        }
        let env = agent_env::get_agent_env()?;
        Ok(env.api_key.as_deref().unwrap_or("").trim().is_empty()
            && !env
                .base_url
                .as_deref()
                .is_some_and(agent_config::is_loopback_url))
    })
    .await?
}

// Only launch a subscription engine explicitly selected after live verification.
#[tauri::command]
pub async fn get_codex_agent_env() -> Result<Option<BTreeMap<String, String>>, String> {
    crate::blocking(|| {
        let Some((id, runtime)) = ai_integrations::selected_cli()? else {
            return Ok(None);
        };
        if id != "codex" {
            return Ok(None);
        }
        codex_environment(&runtime).map(Some)
    })
    .await?
}

#[tauri::command]
pub async fn get_gemini_agent_env() -> Result<Option<BTreeMap<String, String>>, String> {
    crate::blocking(|| match ai_integrations::selected_cli()? {
        Some((id, runtime)) if id == "gemini" => gemini_environment(&runtime).map(Some),
        _ => Ok(None),
    })
    .await?
}

/// The sidecar runs Gemini CLI headless per prompt with these fixed arguments.
pub(crate) fn gemini_environment(
    runtime: &crate::ai_runtime::AiRuntime,
) -> Result<BTreeMap<String, String>, String> {
    let path = runtime
        .resolve("gemini")?
        .ok_or("Gemini CLI not found. Check AI providers.")?;
    let command = ai_cli::command(&path)?;
    let mut args: Vec<String> = command
        .get_args()
        .map(|v| v.to_string_lossy().into_owned())
        .collect();
    args.extend(crate::ai_gemini::agent_args());
    let isolation = crate::ai_gemini_isolation::prepare(&crate::ai_gemini_isolation::dir(), true)?;
    args.extend(isolation.args);
    let home = crate::ai_gemini::cli_home(&runtime.config_home("gemini")?);
    let mut env: BTreeMap<String, String> = isolation.env.into_iter().collect();
    env.extend(BTreeMap::from([
        (
            "CAIRNGORM_GEMINI_COMMAND".into(),
            serde_json::json!({
                "program": command.get_program().to_string_lossy(), "args": args,
            })
            .to_string(),
        ),
        (
            "GEMINI_CLI_HOME".into(),
            home.to_string_lossy().into_owned(),
        ),
    ]));
    Ok(env)
}

pub(crate) fn codex_environment(
    runtime: &crate::ai_runtime::AiRuntime,
) -> Result<BTreeMap<String, String>, String> {
    let path = runtime
        .resolve("codex")?
        .ok_or("Codex CLI not found. Check AI providers.")?;
    let command = ai_cli::command(&path)?;
    let mut args: Vec<String> = command
        .get_args()
        .map(|v| v.to_string_lossy().into_owned())
        .collect();
    // Workspace edits are allowed; outside-workspace approvals fail closed.
    for config in [
        "sandbox_mode=\"workspace-write\"",
        "sandbox_workspace_write.network_access=false",
        "approval_policy=\"never\"",
        "features.hooks=false",
        "features.apps=false",
        "features.remote_plugin=false",
        "notify=[]",
        "web_search=\"disabled\"",
    ] {
        args.extend(["-c".into(), config.into()]);
    }
    let mut env = BTreeMap::new();
    env.insert(
        "CAIRNGORM_CODEX_COMMAND".into(),
        serde_json::json!({
            "program": command.get_program().to_string_lossy(), "args": args,
        })
        .to_string(),
    );
    env.insert(
        "CODEX_HOME".into(),
        runtime.config_home("codex")?.to_string_lossy().into_owned(),
    );
    Ok(env)
}
