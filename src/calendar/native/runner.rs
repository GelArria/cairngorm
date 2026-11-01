use super::task::Task;
use std::{path::Path, time::Duration};

pub fn execute(task: &Task) -> Result<String, String> {
    super::ensure_supported()?;
    let root = Path::new(&task.input.root_path);
    if !root.is_absolute() || !root.is_dir() {
        return Err("The scheduled project's folder is no longer available.".into());
    }
    let runner = crate::agent_env::resolve_agent_runner()?;
    let mut args = runner.args;
    if runner.agent_path.ends_with(".js") || runner.agent_path.ends_with(".ts") {
        args.push(runner.agent_path);
    }
    args.extend([
        "--sidecar".into(),
        "--scheduled".into(),
        "--session-id".into(),
        uuid::Uuid::new_v4().to_string(),
    ]);
    match task.input.agent.as_str() {
        "codex" => args.push("--codex".into()),
        "gemini" => args.push("--gemini".into()),
        _ => {}
    }
    let environment = crate::agent_env::launch_environment(&runner.runner_path, &args)?;
    let mut command = crate::ai_cli::command(Path::new(&runner.runner_path))?;
    command.args(args).envs(environment).current_dir(root);
    let input = format!(
        "{}\n",
        serde_json::json!({ "type": "prompt", "content": task.input.prompt })
    );
    let (success, stdout, _) = crate::ai_cli::run(command, Some(input), Duration::from_secs(1800))
        .map_err(|_| {
            "The scheduled run exceeded its 30-minute limit or could not finish.".to_string()
        })?;
    parse_result(success, &stdout)
}

pub fn parse_result(exited_successfully: bool, stdout: &str) -> Result<String, String> {
    let result: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|_| {
        "The agent did not return a completed result. Check AI providers before retrying."
            .to_string()
    })?;
    let output: String = result["output"]
        .as_str()
        .unwrap_or("")
        .chars()
        .take(16_000)
        .collect();
    if !exited_successfully || result["success"].as_bool() != Some(true) {
        return Err(if output.is_empty() {
            "The agent run failed.".into()
        } else {
            output
        });
    }
    Ok(output)
}
