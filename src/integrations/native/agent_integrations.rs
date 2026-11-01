use super::integration_config::{add_plugin, write_config};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

static INSTALLED: OnceLock<()> = OnceLock::new();

/// Add only our files/hooks; an invalid user config is reported, never overwritten.
pub fn install_once() {
    INSTALLED.get_or_init(|| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        // The user removed Cairngorm from agent configs: do not add it back on its own.
        if home.is_empty() || crate::agent_cleanup::removed(Path::new(&home)) {
            return;
        }
        for result in install(Path::new(&home)) {
            if let Err(err) = result {
                eprintln!("[cairngorm integrations] {err}");
            }
        }
    });
}

fn asset(path: &Path, content: &str) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("missing parent")?).map_err(|e| e.to_string())?;
    if fs::read_to_string(path).ok().as_deref() != Some(content) {
        fs::write(path, content).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn register(dir: &Path, filename: &str, key: &str, plugin: &str) -> Result<(), String> {
    let path = dir.join(filename);
    let text = if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        "{}".into()
    };
    let updated = add_plugin(&text, key, plugin).map_err(|e| format!("{}: {e}", path.display()))?;
    write_config(&path, &updated)
}

fn install_opencode(dir: &Path) -> Result<(), String> {
    asset(
        &dir.join("cairngorm-session.js"),
        include_str!("../assets/opencode-session.js"),
    )?;
    let v1 = if dir.join("tui.json").exists() {
        "tui.json"
    } else {
        "tui.jsonc"
    };
    register(dir, v1, "plugin", "./cairngorm-session.js")?;
    // V1 merges both files; preserve both existing plugin lists, comments included.
    if v1 == "tui.json" && dir.join("tui.jsonc").exists() {
        register(dir, "tui.jsonc", "plugin", "./cairngorm-session.js")?;
    }
    asset(
        &dir.join("cairngorm-session/tui.js"),
        "export { default } from '../cairngorm-session.js';\n",
    )?;
    // Don't preempt V2's migration of existing V1 preferences by creating cli.json.
    if dir.join("cli.json").exists() {
        register(dir, "cli.json", "plugins", "./cairngorm-session")?;
    }
    Ok(())
}

/// How an agent's configuration lists hook commands.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum HookLayout {
    /// Claude-compatible `{"hooks": {"SessionStart": [{"hooks": [{"command"}]}]}}`, with
    /// the agent's timeout unit (Gemini and Qwen read milliseconds).
    Nested { timeout: u64 },
    /// Cursor's `{"version": 1, "hooks": {"sessionStart": [{"command"}]}}`.
    Cursor,
    /// Copilot's `{"version": 1, "hooks": {"sessionStart": [{"powershell"|"bash"}]}}`.
    Copilot,
}

// Windows PowerShell start plus process inspection needs headroom beyond a few seconds.
const CLAUDE_STYLE: HookLayout = HookLayout::Nested { timeout: 10 };

fn hook_script(dir: &Path) -> Result<PathBuf, String> {
    let (filename, content) = if cfg!(windows) {
        (
            "cairngorm-session.ps1",
            include_str!("../assets/agent-session-hook.ps1"),
        )
    } else {
        (
            "cairngorm-session.py",
            include_str!("../assets/agent-session-hook.py"),
        )
    };
    let hook = dir.join("hooks").join(filename);
    asset(&hook, content)?;
    Ok(hook)
}

fn hook_command(hook: &Path, agent: &str) -> Result<String, String> {
    if cfg!(windows) {
        // Git Bash and PowerShell expand $ and backticks even inside double quotes.
        let p = hook.to_string_lossy();
        if p.contains(['"', '%', '$', '`', '\n', '\r']) {
            return Err("unsupported hook path".into());
        }
        Ok(format!(
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{p}\" {agent}"
        ))
    } else {
        Ok(format!(
            "python3 '{}' {agent}",
            hook.to_string_lossy().replace('\'', "'\\''")
        ))
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({}));
    }
    serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// True when an event already runs a Cairngorm session script. Codex imports Claude's hook
/// and records trust for that exact entry, so it is kept rather than duplicated or rewritten.
fn runs_session_script(entries: &[Value]) -> bool {
    entries.iter().any(|group| {
        std::iter::once(group)
            .chain(group["hooks"].as_array().into_iter().flatten())
            .flat_map(|h| ["command", "powershell", "bash"].map(|key| h[key].as_str()))
            .flatten()
            .any(|c| c.contains("cairngorm-session."))
    })
}

#[cfg(test)]
pub(crate) fn install_hook(dir: &Path, agent: &str) -> Result<(), String> {
    install_hook_into(dir, &dir.join("settings.json"), agent, CLAUDE_STYLE)
}

/// Adds the shared session hook to one agent configuration, keeping every other entry.
pub(crate) fn install_hook_into(
    dir: &Path,
    config: &Path,
    agent: &str,
    layout: HookLayout,
) -> Result<(), String> {
    let hook = hook_script(dir)?;
    let command = hook_command(&hook, agent)?;
    let mut value = read_json(config)?;
    let root = value
        .as_object_mut()
        .ok_or("agent settings must be an object")?;
    if matches!(layout, HookLayout::Cursor | HookLayout::Copilot) {
        root.entry("version").or_insert(json!(1));
    }
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("hooks must be an object")?;
    // SessionStart may omit the mode; later events also capture permission changes, and
    // Copilot's prompt event backs up a sessionStart that some versions do not fire.
    let events: &[&str] = match (layout, agent) {
        (HookLayout::Cursor, _) => &["sessionStart", "beforeSubmitPrompt"],
        (HookLayout::Copilot, _) => &["sessionStart", "userPromptSubmitted"],
        (_, "claude" | "codex" | "grok") => &["SessionStart", "UserPromptSubmit", "Stop"],
        _ => &["SessionStart"],
    };
    for event in events {
        let entries = hooks
            .entry(*event)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| format!("{event} must be an array"))?;
        if runs_session_script(entries) {
            // Refresh the timeout of Cairngorm's own entry; Codex trust covers the exact entry.
            if let (HookLayout::Nested { timeout }, false) = (layout, agent == "codex") {
                for hook in entries
                    .iter_mut()
                    .flat_map(|group| group["hooks"].as_array_mut().into_iter().flatten())
                    .filter(|hook| hook["command"].as_str() == Some(&command))
                {
                    hook["timeout"] = json!(timeout);
                }
            }
            continue;
        }
        entries.push(match layout {
            HookLayout::Cursor => json!({ "command": command }),
            HookLayout::Copilot => {
                let shell = if cfg!(windows) { "powershell" } else { "bash" };
                json!({ "type": "command", shell: command, "timeoutSec": 10 })
            }
            HookLayout::Nested { timeout } => {
                json!({ "hooks": [{ "type": "command", "command": command, "timeout": timeout }] })
            }
        });
    }
    write_config(
        config,
        &serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?,
    )
}

/// Reads a folder override; cleanup also passes one that sees none, to reach the defaults.
pub(crate) type EnvLookup<'a> = &'a dyn Fn(&str) -> Option<std::ffi::OsString>;

pub(crate) fn real_env(var: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(var)
}

fn config_dir(home: &Path, env: EnvLookup, var: &str, default: &str) -> PathBuf {
    env(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(default))
}

pub(crate) fn pi_dir(home: &Path, env: EnvLookup) -> PathBuf {
    config_dir(home, env, "PI_CODING_AGENT_DIR", ".pi/agent")
}

pub(crate) fn opencode_dir(home: &Path, env: EnvLookup) -> PathBuf {
    config_dir(home, env, "XDG_CONFIG_HOME", ".config").join("opencode")
}

/// `GEMINI_CLI_HOME` replaces the home folder, not the `.gemini` folder inside it. Gemini
/// CLI ignores an empty value. A relative one depends on each launch's folder, so Cairngorm
/// keeps the default rather than writing config somewhere arbitrary.
pub(crate) fn gemini_dir(home: &Path, env: EnvLookup) -> PathBuf {
    env("GEMINI_CLI_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute())
        .unwrap_or_else(|| home.to_path_buf())
        .join(".gemini")
}

pub fn install(home: &Path) -> Vec<Result<(), String>> {
    let mut results = Vec::new();
    let pi = pi_dir(home, &real_env);
    if pi.is_dir() {
        results.push(asset(
            &pi.join("extensions/cairngorm-session.ts"),
            include_str!("../assets/pi-session.ts"),
        ));
    }
    let opencode = opencode_dir(home, &real_env);
    if opencode.is_dir() {
        results.push(install_opencode(&opencode));
    }
    for (dir, file, agent, layout) in hook_targets(home, &real_env) {
        if dir.is_dir() {
            results.push(install_hook_into(&dir, &dir.join(file), agent, layout));
        }
    }
    results
}

/// Each hook-based agent: its folder, the config file inside it, its id and hook layout.
pub(crate) fn hook_targets(
    home: &Path,
    env: EnvLookup,
) -> [(PathBuf, PathBuf, &'static str, HookLayout); 8] {
    let codex = config_dir(home, env, "CODEX_HOME", ".codex");
    let copilot = config_dir(home, env, "COPILOT_HOME", ".copilot");
    let cursor = config_dir(home, env, "CURSOR_CONFIG_DIR", ".cursor");
    let grok = config_dir(home, env, "GROK_HOME", ".grok");
    let milliseconds = HookLayout::Nested { timeout: 10000 };
    // Only agents the user already configured; a missing folder means the CLI is not set up.
    [
        (
            home.join(".factory"),
            PathBuf::from("settings.json"),
            "droid",
            CLAUDE_STYLE,
        ),
        (
            config_dir(home, env, "CLAUDE_CONFIG_DIR", ".claude"),
            "settings.json".into(),
            "claude",
            CLAUDE_STYLE,
        ),
        (
            gemini_dir(home, env),
            "settings.json".into(),
            "gemini",
            milliseconds,
        ),
        (
            config_dir(home, env, "QWEN_HOME", ".qwen"),
            "settings.json".into(),
            "qwen",
            milliseconds,
        ),
        // Codex asks the user to trust each new hook once with /hooks.
        (codex, "hooks.json".into(), "codex", CLAUDE_STYLE),
        // Copilot and Grok merge every hooks/*.json file, so Cairngorm owns one of its own.
        (
            copilot,
            "hooks/cairngorm.json".into(),
            "copilot",
            HookLayout::Copilot,
        ),
        (grok, "hooks/cairngorm.json".into(), "grok", CLAUDE_STYLE),
        (cursor, "hooks.json".into(), "cursor", HookLayout::Cursor),
    ]
}
