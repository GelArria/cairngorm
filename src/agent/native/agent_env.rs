use std::{env::consts::EXE_SUFFIX, path::PathBuf};

/// Rust target this app was built for (set by build.rs), e.g. `aarch64-apple-darwin`.
const TARGET: &str = env!("TARGET_TRIPLE");

fn resolve_agent_path_inner() -> Result<String, String> {
    // Built sidecar: `binaries/cairngorm-agent-<triple>`. Tauri externalBin (macOS/Linux)
    // installs it beside the app executable without the triple.
    let sidecar = format!("cairngorm-agent-{TARGET}{EXE_SUFFIX}");
    let installed = format!("cairngorm-agent{EXE_SUFFIX}");
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();
    let cwd = std::env::current_dir().unwrap_or_default();
    let candidates: Vec<PathBuf> = vec![
        // Priority 1: compiled sidecar binary (self-contained, no runtime needed)
        exe_dir.join(&installed),
        exe_dir.join("binaries").join(&sidecar),
        exe_dir
            .join("..")
            .join("..")
            .join("binaries")
            .join(&sidecar),
        cwd.join("src-tauri").join("binaries").join(&sidecar),
        // Priority 2: bundled JS output (needs bun/node runtime)
        cwd.join("src/agent/core").join("dist").join("cli.js"),
        cwd.join("..")
            .join("src/agent/core")
            .join("dist")
            .join("cli.js"),
        exe_dir
            .join("..")
            .join("..")
            .join("src/agent/core")
            .join("dist")
            .join("cli.js"),
        // Priority 3: raw .ts (requires bun + local node_modules — dev only)
        cwd.join("src/agent/core").join("src").join("cli.ts"),
        cwd.join("..")
            .join("src/agent/core")
            .join("src")
            .join("cli.ts"),
        exe_dir
            .join("..")
            .join("..")
            .join("src/agent/core")
            .join("src")
            .join("cli.ts"),
    ];
    for c in &candidates {
        let clean = match c.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if clean.exists() && clean.is_file() {
            let mut s = clean
                .to_str()
                .map(|s| s.to_string())
                .ok_or_else(|| "non-utf8 path".to_string())?;
            // Strip UNC prefix \\?\ on Windows — Node.js doesn't handle it
            if s.starts_with(r"\\?\") {
                s = s[4..].to_string();
            }
            return Ok(s);
        }
    }
    let tried = candidates
        .iter()
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!("cairngorm-agent CLI not found. Tried: {}", tried))
}

#[tauri::command(async)]
pub fn resolve_agent_path() -> Result<String, String> {
    resolve_agent_path_inner()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunner {
    pub(crate) agent_path: String,
    pub(crate) runner_path: String,
    name: String,
    pub(crate) args: Vec<String>,
}

/// Detect the best runner for the agent CLI.
/// Returns the resolved agent path and how to run it.
#[tauri::command(async)]
pub fn resolve_agent_runner() -> Result<AgentRunner, String> {
    let agent_path = resolve_agent_path_inner()?;

    // Anything but a script is the compiled sidecar (no extension outside Windows).
    let lower = agent_path.to_lowercase();
    let is_binary = !lower.ends_with(".js") && !lower.ends_with(".ts");
    if is_binary {
        return Ok(AgentRunner {
            agent_path: agent_path.clone(),
            runner_path: agent_path,
            name: "cairngorm-agent".into(),
            args: vec![],
        });
    }

    let is_cli_ts = agent_path.ends_with(".ts");

    // Bun can run .ts directly — preferred for JS/TS
    if let Ok(path) = which::which("bun") {
        let p = path.to_str().unwrap_or("bun").to_string();
        return Ok(AgentRunner {
            agent_path,
            runner_path: p,
            name: "bun".into(),
            args: vec![],
        });
    }

    // Node needs the .js bundle, but still works
    if let Ok(path) = which::which("node") {
        let p = path.to_str().unwrap_or("node").to_string();
        let args = if is_cli_ts {
            vec!["--experimental-strip-types".to_string()]
        } else {
            vec![]
        };
        return Ok(AgentRunner {
            agent_path,
            runner_path: p,
            name: "node".into(),
            args,
        });
    }

    // Last resort: assume bun is in PATH at runtime
    Ok(AgentRunner {
        agent_path,
        runner_path: "bun".into(),
        name: "bun".into(),
        args: vec![],
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnv {
    pub(crate) api_key_env: String,
    #[serde(skip_serializing)]
    pub(crate) api_key: Option<String>,
    pub(crate) key_available: bool,
    pub(crate) base_url: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) provider: Option<String>,
}

#[tauri::command(async)]
pub fn get_agent_env() -> Result<AgentEnv, String> {
    let config = crate::agent_config::try_read_config()?;
    let cfg = serde_json::Value::Object(config.clone());
    let configured = cfg["model"].as_str().is_some_and(|v| !v.trim().is_empty())
        && cfg["baseUrl"]
            .as_str()
            .is_some_and(|v| !v.trim().is_empty());
    if configured {
        let base =
            crate::agent_config::validate_base_url(cfg["baseUrl"].as_str().unwrap_or_default())?;
        let key_env = cfg["apiKeyEnv"].as_str().unwrap_or("OPENAI_API_KEY");
        let key = crate::agent_config::credentials::read(&config)?
            .or_else(|| std::env::var(key_env).ok())
            .filter(|key| !key.is_empty())
            .or_else(|| {
                (cfg["keyOptional"].as_bool() == Some(true)
                    || crate::agent_config::is_loopback_url(&base))
                .then(|| "local".into())
            });
        return Ok(AgentEnv {
            api_key_env: key_env.into(),
            key_available: key.is_some(),
            api_key: key,
            base_url: Some(base),
            model: cfg["model"].as_str().map(String::from),
            provider: cfg["provider"].as_str().map(String::from),
        });
    }
    Ok(AgentEnv {
        api_key_env: "OPENAI_API_KEY".into(),
        api_key: None,
        key_available: false,
        base_url: None,
        model: None,
        provider: None,
    })
}

#[path = "agent_process_env.rs"]
mod process_env;
pub(crate) use process_env::launch_environment;
