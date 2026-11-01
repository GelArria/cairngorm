// Official CLIs own their credentials. Never import tokens or run in a repository.
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub(crate) fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

/// The npm package scripts behind each CLI's shell launcher.
pub(crate) fn npm_entries(id: &str) -> &'static [&'static str] {
    match id {
        "codex" => &["node_modules/@openai/codex/bin/codex.js"],
        "gemini" => crate::ai_gemini::NPM_ENTRIES,
        _ => &["node_modules/@anthropic-ai/claude-code/cli.js"],
    }
}

pub(crate) fn resolve(id: &str) -> Option<PathBuf> {
    if !matches!(id, "codex" | "claude" | "gemini") {
        return None;
    }
    let mut paths = Vec::new();
    // Native installs and npm launchers: do not invoke .cmd through a shell.
    if cfg!(windows) {
        paths.push(home().join(".local/bin").join(format!("{id}.exe")));
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let npm = PathBuf::from(appdata).join("npm");
            if id == "codex" {
                // Codex's bundled native binary; newer releases moved it into `bin`.
                let vendor = npm.join("node_modules/@openai/codex/node_modules/@openai");
                for (package, triple) in [
                    ("codex-win32-x64", "x86_64-pc-windows-msvc"),
                    ("codex-win32-arm64", "aarch64-pc-windows-msvc"),
                ] {
                    let dir = vendor.join(package).join("vendor").join(triple);
                    paths.push(dir.join("bin/codex.exe"));
                    paths.push(dir.join("codex/codex.exe"));
                }
            }
            paths.extend(npm_entries(id).iter().map(|entry| npm.join(entry)));
        }
    }
    if let Some(p) = crate::cli_paths::find(id) {
        if crate::cli_paths::is_launcher(&p) {
            paths.extend(crate::cli_paths::launcher_script(&p, npm_entries(id)));
        } else {
            paths.push(p);
        }
    }
    paths.into_iter().find(|p| p.is_file())
}

pub(crate) fn command(path: &Path) -> Result<Command, String> {
    let mut c = if crate::cli_paths::is_node_entry(path) {
        // nvm, Volta and fnm keep the matching Node beside the CLI they installed.
        let node = crate::cli_paths::node_beside(path)
            .or_else(|| crate::cli_paths::find("node"))
            .ok_or("Node.js is required for this CLI installation.")?;
        let mut c = Command::new(node);
        c.arg(crate::cli_paths::node_script_path(path));
        c
    } else {
        Command::new(path)
    };
    // Shell launchers and npm scripts look up `node` themselves.
    c.env("PATH", crate::cli_paths::search_path());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | CREATE_SUSPENDED: assign the job before any child runs.
        c.creation_flags(0x0800_0004);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        c.process_group(0);
    }
    Ok(c)
}

fn stop(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn capture(mut reader: impl Read) -> Vec<u8> {
    let mut result = Vec::new();
    let mut buf = [0; 4096];
    while let Ok(n) = reader.read(&mut buf) {
        if n == 0 {
            break;
        }
        result.extend_from_slice(&buf[..n.min(256_000usize.saturating_sub(result.len()))]);
    }
    result
}

pub(crate) fn run(
    mut c: Command,
    input: Option<String>,
    timeout: Duration,
) -> Result<(bool, String, String), String> {
    let mut child = c
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Could not start the CLI. Check its installation.")?;
    let tree = match crate::ai_process::ProcessTree::watch(&child) {
        Ok(tree) => tree,
        Err(error) => {
            stop(&mut child);
            return Err(error);
        }
    };
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || capture(stdout));
    let err = thread::spawn(move || capture(stderr));
    // A CLI that never reads stdin must still obey the deadline.
    let writer = input.map(|input| {
        let mut stdin = child.stdin.take().unwrap();
        thread::spawn(move || stdin.write_all(input.as_bytes()))
    });
    let start = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status.success()),
            Ok(None) if start.elapsed() < timeout => thread::sleep(Duration::from_millis(30)),
            Ok(None) => {
                stop(&mut child);
                break Err("CLI timed out. Try again in Settings → AI providers.");
            }
            Err(_) => {
                stop(&mut child);
                break Err("Could not wait for the CLI.");
            }
        }
    };
    drop(tree); // Also closes pipes held by descendants after the CLI itself exits.
    if let Some(writer) = writer {
        let _ = writer.join();
    }
    let stdout = String::from_utf8_lossy(&out.join().unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&err.join().unwrap_or_default()).into_owned();
    Ok((result?, stdout, stderr))
}

pub(crate) fn draft_args(id: &str) -> Vec<String> {
    if id == "gemini" {
        return crate::ai_gemini::draft_args();
    }
    let args: &[&str] = if id == "claude" {
        &[
            "--bare",
            "--print",
            "--output-format",
            "json",
            "--tools",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--setting-sources",
            "",
            "--settings",
            "{\"disableAllHooks\":true}",
            "--disable-slash-commands",
            "--no-session-persistence",
        ]
    } else {
        &[
            "exec",
            "--json",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "-c",
            "approval_policy=\"never\"",
            "-c",
            "features.shell_tool=false",
            "-c",
            "features.unified_exec=false",
            "-c",
            "features.hooks=false",
            "-c",
            "features.multi_agent=false",
            "-c",
            "features.apps=false",
            "-c",
            "features.remote_plugin=false",
            "-c",
            "notify=[]",
            "-c",
            "web_search=\"disabled\"",
            "-c",
            "project_doc_max_bytes=0",
        ]
    };
    args.iter().map(|s| (*s).into()).collect()
}

pub(crate) fn parse_draft(id: &str, output: &str) -> Result<String, String> {
    let text = if id == "gemini" {
        crate::ai_gemini::parse_draft(output)?
    } else if id == "claude" {
        let body: serde_json::Value = serde_json::from_str(output)
            .map_err(|_| "Unsupported Claude Code response. Update the CLI.")?;
        if body["is_error"].as_bool() != Some(false) {
            return Err(
                "Claude Code could not complete the request. Check your session and quota.".into(),
            );
        }
        body["result"].as_str().unwrap_or("").to_string()
    } else {
        output
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter(|v| v["type"] == "item.completed" && v["item"]["type"] == "agent_message")
            .filter_map(|v| v["item"]["text"].as_str().map(String::from))
            .last()
            .unwrap_or_default()
    };
    let text = text.trim();
    if text.is_empty() || text.len() > 4_000 {
        return Err("CLI returned an empty or oversized draft. Try again.".into());
    }
    Ok(text.into())
}

pub(crate) fn request_error(output: &str) -> String {
    if output.to_lowercase().contains("usage limit") {
        "Codex usage limit reached. Check ChatGPT → Settings → Usage, wait for the reset or choose another provider in AI providers.".into()
    } else {
        "CLI request failed. Check your session, CLI version and quota in Settings → AI providers."
            .into()
    }
}

pub(crate) fn request(
    id: &str,
    runtime: &crate::ai_runtime::AiRuntime,
    prompt: String,
    acknowledgement: Option<&str>,
) -> Result<String, String> {
    if id == "claude" {
        crate::claude_api::authorize(runtime, acknowledgement)?;
    }
    let path = runtime
        .resolve(id)?
        .ok_or("CLI not found. Open Settings → AI providers.")?;
    let dir = std::env::temp_dir().join(format!("cairngorm-ai-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).map_err(|_| "Could not create a temporary CLI workspace.")?;
    let result = (|| {
        let mut c = command(&path)?;
        if id == "claude" {
            crate::claude_api::apply(&mut c)?;
        }
        runtime.apply(&mut c, id)?;
        c.current_dir(&dir).args(draft_args(id));
        // Codex ignores inherited provider/MCP/hooks/rules config, retaining its CLI-owned auth.
        if id == "codex" {
            c.arg("-");
        }
        if id == "gemini" {
            let isolation =
                crate::ai_gemini_isolation::prepare(&crate::ai_gemini_isolation::dir(), false)?;
            c.args(isolation.args).envs(isolation.env);
        }
        // Cairngorm's own session hook must never report this one-shot run.
        c.env_remove("CAIRNGORM_SESSION_REPORT");
        let (ok, stdout, stderr) = run(c, Some(prompt), Duration::from_secs(90))?;
        if !ok {
            return Err(if id == "gemini" {
                crate::ai_gemini::request_error(&format!("{stdout}\n{stderr}"))
            } else {
                request_error(&stdout)
            });
        }
        parse_draft(id, &stdout)
    })();
    let _ = std::fs::remove_dir_all(dir);
    result
}
