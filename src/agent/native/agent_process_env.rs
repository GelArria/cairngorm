//! Only the installed sidecar receives provider credentials, directly from Rust.
use std::collections::BTreeMap;

pub fn launch_environment(
    shell: &str,
    args: &[String],
) -> Result<BTreeMap<String, String>, String> {
    let runner = super::resolve_agent_runner()?;
    if std::fs::canonicalize(shell).ok() != std::fs::canonicalize(&runner.runner_path).ok()
        || std::fs::canonicalize(shell).is_err()
    {
        return Err(
            "Agent credentials are only available to the configured sidecar runner.".into(),
        );
    }
    let script = runner.agent_path.ends_with(".js") || runner.agent_path.ends_with(".ts");
    let mut prefix = runner.args;
    if script {
        prefix.push(runner.agent_path);
    }
    if !args.starts_with(&prefix) || !valid_arguments(&args[prefix.len()..]) {
        return Err("Invalid Cairngorm agent launch arguments.".into());
    }
    if args.iter().any(|arg| arg == "--codex") {
        return tauri::async_runtime::block_on(crate::ai_native::get_codex_agent_env())?
            .ok_or("Codex is no longer selected. Verify it in AI providers.".into());
    }
    if args.iter().any(|arg| arg == "--gemini") {
        return tauri::async_runtime::block_on(crate::ai_native::get_gemini_agent_env())?
            .ok_or("Gemini CLI is no longer selected. Verify it in AI providers.".into());
    }
    let config = super::get_agent_env()?;
    let key = config
        .api_key
        .ok_or("Configure an API key in AI providers before starting the agent.")?;
    Ok(BTreeMap::from([
        ("CAIRNGORM_AGENT_API_KEY".into(), key),
        ("CAIRNGORM_AGENT_KEY_ENV".into(), config.api_key_env),
    ]))
}

fn valid_arguments(args: &[String]) -> bool {
    if !args.iter().any(|arg| arg == "--sidecar") {
        return false;
    }
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--sidecar" | "--codex" | "--gemini" | "--scheduled" => i += 1,
            "--session-id" | "--profile" | "--model"
                if args.get(i + 1).is_some_and(|v| !v.starts_with('-')) =>
            {
                i += 2
            }
            _ => return false,
        }
    }
    true
}
