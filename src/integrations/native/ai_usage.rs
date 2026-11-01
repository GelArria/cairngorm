// Subscription plans and quota without spending model quota. Codex answers from its
// app-server account state. Claude Code limits come from its status line, saved by the
// relay in claude_statusline.rs (`claude --print /usage` sends a model request). Gemini CLI
// shares its quota only inside its own terminal UI, so only its plan is shown.
use crate::{
    ai_cli,
    ai_detection::detect,
    ai_integrations,
    ai_runtime::AiRuntime,
    ai_usage_parse::{parse_codex, CodexUsage, UsageWindow},
};
use serde::Serialize;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    process::Stdio,
    sync::mpsc,
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    id: String,
    name: String,
    plan: Option<String>,
    windows: Vec<UsageWindow>,
    error: Option<String>,
    /// Unix seconds when the limits were last seen, when they are not read live.
    updated_at: Option<i64>,
    /// Why no limits are shown, when that is expected rather than an error.
    note: Option<String>,
    /// A block the windows alone do not show, such as a spend limit.
    warning: Option<String>,
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

const CLAUDE_NOTE: &str =
    "Limits appear here once Claude Code answers its first message in any terminal.";

fn codex_usage(runtime: &AiRuntime) -> Result<CodexUsage, String> {
    let cli = runtime.resolve("codex")?.ok_or("CLI not found.")?;
    let mut c = ai_cli::command(&cli)?;
    runtime.apply(&mut c, "codex")?;
    c.current_dir(std::env::temp_dir())
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = c.spawn().map_err(|_| "Could not start the CLI.")?;
    let tree = match crate::ai_process::ProcessTree::watch(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let (tx, rx) = mpsc::channel();
    let stdout = child.stdout.take().unwrap();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    // The app-server exits on stdin EOF before answering, so stdin stays open until the reply.
    let mut stdin = child.stdin.take().unwrap();
    let request = concat!(
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"cairngorm","version":"1.0.0"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","method":"initialized"}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read"}"#,
        "\n",
    );
    let written = stdin
        .write_all(request.as_bytes())
        .and_then(|_| stdin.flush());
    let deadline = Instant::now() + TIMEOUT;
    let reply = written
        .map_err(|_| "Could not query Codex.".to_string())
        .and_then(|_| loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let line = rx.recv_timeout(left).map_err(|e| match e {
                mpsc::RecvTimeoutError::Timeout => {
                    "Codex did not report usage in time.".to_string()
                }
                // The server exited without replying, e.g. a CLI without `app-server`.
                mpsc::RecvTimeoutError::Disconnected => {
                    "Codex could not report usage. Update the CLI.".to_string()
                }
            })?;
            match serde_json::from_str::<Value>(&line) {
                // Server-initiated requests share no id space with ours and carry a method.
                Ok(msg) if msg["id"] == 2 && msg.get("method").is_none() => break Ok(msg),
                _ => continue,
            }
        });
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    drop(tree);
    let reply = reply?;
    if !reply["error"].is_null() {
        return Err("Codex could not read usage. Sign in with ChatGPT and update the CLI.".into());
    }
    parse_codex(&reply["result"], unix_now())
}

pub(crate) fn report(id: &str, runtime: AiRuntime) -> Option<UsageReport> {
    let service = detect(id, runtime.clone());
    // Only subscription logins have plans and quota windows; API keys bill per token.
    // The login is shown whether or not Cairngorm may use the service.
    let login = service.login.clone().filter(|login| login.subscription)?;
    if id == "gemini" {
        return Some(UsageReport {
            id: id.into(),
            name: service.name,
            plan: login.plan,
            windows: Vec::new(),
            error: None,
            updated_at: None,
            note: Some(crate::ai_gemini::USAGE_NOTE.into()),
            warning: None,
        });
    }
    if id == "claude" {
        let saved = runtime
            .config_home("claude")
            .ok()
            .and_then(|dir| crate::claude_statusline::read_usage(&dir, unix_now()));
        let (updated_at, windows) = saved.unwrap_or_default();
        return Some(UsageReport {
            id: id.into(),
            name: service.name,
            plan: login.plan,
            note: windows.is_empty().then(|| CLAUDE_NOTE.into()),
            windows,
            error: None,
            updated_at,
            warning: None,
        });
    }
    let (usage, error) = match codex_usage(&runtime) {
        Ok(usage) => (usage, None),
        Err(error) => (CodexUsage::default(), Some(error)),
    };
    Some(UsageReport {
        id: id.into(),
        name: service.name,
        plan: usage.plan,
        windows: usage.windows,
        error,
        updated_at: None,
        note: None,
        warning: usage.warning,
    })
}

#[tauri::command]
pub async fn read_ai_usage() -> Result<Vec<UsageReport>, String> {
    crate::blocking(|| {
        let config = ai_integrations::read_config()?;
        let codex_runtime = config.runtime("codex");
        let codex = std::thread::spawn(move || report("codex", codex_runtime));
        let gemini_runtime = config.runtime("gemini");
        let gemini = std::thread::spawn(move || report("gemini", gemini_runtime));
        let claude = report("claude", config.runtime("claude"));
        let codex = codex.join().map_err(|_| "Codex usage check failed.")?;
        let gemini = gemini
            .join()
            .map_err(|_| "Gemini CLI usage check failed.")?;
        Ok(codex.into_iter().chain(claude).chain(gemini).collect())
    })
    .await?
}
