//! Presence-only CLI discovery. Scanning never authenticates or executes an agent.
use serde::Serialize;
use std::path::{Path, PathBuf};

pub(crate) const CLIS: &[(&str, &str, &str, &str)] = &[
    ("pi", "Pi", "pi", "@earendil-works/pi-coding-agent"),
    (
        "claude",
        "Claude Code",
        "claude",
        "@anthropic-ai/claude-code",
    ),
    ("codex", "Codex", "codex", "@openai/codex"),
    ("qwen", "Qwen Code", "qwen", "@qwen-code/qwen-code"),
    ("gemini", "Gemini CLI", "gemini", "@google/gemini-cli"),
    ("opencode", "OpenCode", "opencode", "opencode-ai"),
    ("droid", "Droid", "droid", ""),
    ("cursor", "Cursor CLI", "cursor-agent", ""),
    ("copilot", "GitHub Copilot", "copilot", "@github/copilot"),
    ("amp", "Amp", "amp", "@sourcegraph/amp"),
    ("kimi", "Kimi Code", "kimi", ""),
    ("kiro", "Kiro CLI", "kiro-cli", ""),
    ("auggie", "Auggie", "auggie", "@augmentcode/auggie"),
    ("cline", "Cline", "cline", "cline"),
    ("kilo", "Kilo Code", "kilo", "@kilocode/cli"),
    ("continue", "Continue", "cn", "@continuedev/cli"),
    ("crush", "Crush", "crush", "@charmland/crush"),
    ("codebuff", "Codebuff", "codebuff", "codebuff"),
    ("letta", "Letta Code", "letta", "@letta-ai/letta-code"),
    ("commandcode", "Command Code", "commandcode", "command-code"),
    ("grok", "Grok Build", "grok", "@xai-official/grok"),
    ("junie", "Junie", "junie", "@jetbrains/junie-cli"),
    ("openclaw", "OpenClaw", "openclaw", "openclaw"),
    ("qodo", "Qodo Command", "qodo", "@qodo/command"),
    ("vibe", "Mistral Vibe", "vibe", ""),
    ("trae", "Trae Agent", "trae-cli", ""),
    ("aider", "Aider", "aider", ""),
    ("openhands", "OpenHands", "openhands", ""),
    ("gptme", "gptme", "gptme", ""),
    ("plandex", "Plandex", "plandex", ""),
    ("hermes", "Hermes Agent", "hermes", ""),
    ("omp", "Oh My Pi", "omp", "@oh-my-pi/pi-coding-agent"),
    ("codewhale", "Codewhale", "codewhale", "codewhale"),
    ("neovate", "Neovate Code", "neovate", "@neovate/code"),
    ("strix", "Strix", "strix", ""),
    ("interpreter", "Open Interpreter", "interpreter", ""),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCli {
    pub id: String,
    pub name: String,
    pub program: String,
}

pub(crate) fn find_program(name: &str) -> Option<PathBuf> {
    if let Ok(path) = which::which(name) {
        return Some(path);
    }
    let mut dirs = [".local/bin", ".cargo/bin", ".bun/bin"]
        .map(|part| crate::ai_cli::home().join(part))
        .to_vec();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    dirs.iter().find_map(|dir| {
        let suffixes: &[&str] = if cfg!(windows) {
            &[".exe", ".cmd", ".ps1", ""]
        } else {
            &[""]
        };
        suffixes
            .iter()
            .map(|suffix| dir.join(format!("{name}{suffix}")))
            .find(|path| path.is_file())
    })
}

/// Resolve the declared npm bin, not wrapper source or shell expansions.
pub(crate) fn resolve_program(path: &Path) -> Result<PathBuf, String> {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "cmd" | "bat" | "ps1") {
        return Ok(path.to_path_buf());
    }
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    let (_, _, command, package) = CLIS
        .iter()
        .find(|(_, _, cmd, pkg)| stem.eq_ignore_ascii_case(cmd) && !pkg.is_empty())
        .ok_or("Select the actual executable or JavaScript entry point.")?;
    let root = path
        .parent()
        .ok_or("Invalid CLI path")?
        .join("node_modules")
        .join(package)
        .canonicalize()
        .map_err(|_| "CLI package not found beside its npm launcher.")?;
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("package.json")).map_err(|_| "CLI package manifest not found.")?,
    )
    .map_err(|_| "Invalid CLI package manifest.")?;
    let bin = manifest["bin"]
        .as_str()
        .or_else(|| manifest["bin"][command].as_str())
        .ok_or("CLI package has no matching executable entry.")?;
    let target = root
        .join(bin)
        .canonicalize()
        .map_err(|_| "CLI package executable is missing.")?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("CLI package entry escapes its installation folder.".into());
    }
    Ok(target)
}

#[cfg(test)]
#[path = "../../../tests/native/cli-catalog.rs"]
mod tests;

fn unique_programs(entries: impl Iterator<Item = DetectedCli>) -> Vec<DetectedCli> {
    let mut seen = std::collections::HashSet::new();
    entries
        .filter(|entry| {
            let path = Path::new(&entry.program)
                .canonicalize()
                .unwrap_or_else(|_| PathBuf::from(&entry.program));
            let key = path.to_string_lossy();
            seen.insert(if cfg!(windows) {
                key.to_lowercase()
            } else {
                key.into_owned()
            })
        })
        .collect()
}

#[tauri::command(async)]
pub fn detect_agent_clis() -> Vec<DetectedCli> {
    unique_programs(CLIS.iter().filter_map(|(id, name, command, _)| {
        let path = if matches!(*id, "codex" | "claude") {
            crate::ai_cli::resolve(id)
        } else {
            find_program(command)
        }?;
        let program = resolve_program(&path).ok()?;
        let mut runtime = crate::ai_runtime::AiRuntime {
            binary_path: program.to_string_lossy().into_owned(),
            home_path: String::new(),
        };
        runtime.validate("codex").ok()?;
        Some(DetectedCli {
            id: id.to_string(),
            name: name.to_string(),
            program: program.to_string_lossy().into_owned(),
        })
    }))
}
