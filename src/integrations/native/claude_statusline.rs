// Claude Code subscription limits without spending quota or touching credentials: Claude
// Code passes `rate_limits` to its status line, so Cairngorm installs a small status line
// relay that saves them and still runs the user's previous status line, if any.
use crate::{ai_usage_parse::UsageWindow, integration_config::write_config};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

static INSTALLED: OnceLock<()> = OnceLock::new();
const CHAIN: &str = "cairngorm-statusline.chain";
const RELAY: &str = "cairngorm-statusline";
pub(crate) const USAGE_FILE: &str = "cairngorm-usage.json";

/// Installs into ~/.claude and into the Claude folder Cairngorm reads usage from, when
/// a configured home or CLAUDE_CONFIG_DIR points elsewhere.
pub fn install_once() {
    INSTALLED.get_or_init(|| {
        if !cfg!(windows) && !python_available() {
            return;
        }
        if crate::agent_cleanup::removed(&crate::ai_cli::home()) {
            return;
        }
        for dir in claude_dirs().iter().filter(|dir| dir.is_dir()) {
            if let Err(err) = install(dir) {
                eprintln!("[cairngorm integrations] {err}");
            }
        }
    });
}

/// ~/.claude plus the configured Claude folder, when it points elsewhere.
pub(crate) fn claude_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![crate::ai_cli::home().join(".claude")];
    if let Some(dir) = crate::ai_integrations::read_config()
        .ok()
        .and_then(|config| config.runtime("claude").config_home("claude").ok())
    {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

/// Takes Claude Code's status line back from the relay: the chained previous command is
/// restored, or the setting is removed when there was none. Another tool's status line is
/// left alone. The relay's own files are deleted.
pub(crate) fn uninstall(dir: &Path) -> Result<(), String> {
    let hooks = dir.join("hooks");
    let path = dir.join("settings.json");
    if let Ok(text) = fs::read_to_string(&path) {
        let mut value: Value =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        let ours = value["statusLine"]["command"]
            .as_str()
            .is_some_and(|command| command.contains(RELAY));
        if ours {
            let root = value.as_object_mut().ok_or("settings must be an object")?;
            let previous = fs::read_to_string(hooks.join(CHAIN))
                .map(|text| text.trim().to_string())
                .unwrap_or_default();
            if previous.is_empty() {
                root.remove("statusLine");
            } else {
                root["statusLine"]["command"] = json!(previous);
            }
            write_config(
                &path,
                &serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?,
            )?;
        }
    }
    for name in ["cairngorm-statusline.ps1", "cairngorm-statusline.py", CHAIN] {
        remove_file(&hooks.join(name))?;
    }
    remove_file(&dir.join(USAGE_FILE))
}

fn remove_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("{}: {e}", path.display()))
        }
        _ => Ok(()),
    }
}

/// A relay that cannot run would blank the status line, so Unix needs a real python3.
/// On macOS without developer tools, /usr/bin/python3 is a stub that opens an installer.
pub(crate) fn python_available() -> bool {
    use std::process::{Command, Stdio};
    let runs = |program: &Path, args: &[&str]| {
        Command::new(program)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    };
    let stub_only = cfg!(target_os = "macos") && !runs(Path::new("xcode-select"), &["-p"]);
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join("python3"))
            .filter(|python| python.is_file())
            .filter(|python| !(stub_only && python == Path::new("/usr/bin/python3")))
            .any(|python| runs(&python, &["-c", ""]))
    })
}

fn relay_command(script: &Path) -> Result<String, String> {
    let path = script.to_string_lossy();
    if cfg!(windows) {
        // Claude Code may run it through Git Bash or PowerShell: nothing either expands.
        if path.contains(['"', '%', '$', '`', '\n', '\r']) {
            return Err("unsupported status line path".into());
        }
        Ok(format!(
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{path}\""
        ))
    } else {
        Ok(format!("python3 '{}'", path.replace('\'', "'\''")))
    }
}

/// Points Claude Code's status line at the relay. A previous status line command is kept
/// in the chain file and still runs; an invalid settings file is reported, never rewritten.
pub(crate) fn install(dir: &Path) -> Result<(), String> {
    let (name, content) = if cfg!(windows) {
        (
            "cairngorm-statusline.ps1",
            include_str!("../assets/claude-statusline.ps1"),
        )
    } else {
        (
            "cairngorm-statusline.py",
            include_str!("../assets/claude-statusline.py"),
        )
    };
    let hooks = dir.join("hooks");
    let script = hooks.join(name);
    fs::create_dir_all(&hooks).map_err(|e| e.to_string())?;
    if fs::read_to_string(&script).ok().as_deref() != Some(content) {
        fs::write(&script, content).map_err(|e| e.to_string())?;
    }
    let command = relay_command(&script)?;
    let path = dir.join("settings.json");
    let mut value: Value = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?,
        Err(_) => json!({}),
    };
    let root = value.as_object_mut().ok_or("settings must be an object")?;
    let mut line = match root.get("statusLine") {
        None => json!({ "type": "command" }),
        Some(Value::Object(line)) => Value::Object(line.clone()),
        Some(_) => return Err("statusLine must be an object".into()),
    };
    let previous = line["command"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string();
    if previous == command {
        return Ok(());
    }
    let chain = hooks.join(CHAIN);
    if previous.is_empty() {
        // Nothing to chain, and nothing left over from an earlier status line.
        let _ = fs::remove_file(&chain);
    } else if !previous.contains(RELAY) {
        // Our own relay at another path is replaced, never chained: it would call itself.
        fs::write(&chain, &previous).map_err(|e| e.to_string())?;
    }
    line["type"] = json!("command");
    line["command"] = json!(command);
    root.insert("statusLine".into(), line);
    write_config(
        &path,
        &serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?,
    )
}

/// The limits the relay last saved, and when. A window whose reset time has passed is
/// shown as reset rather than with its old percentage.
pub(crate) fn read_usage(dir: &Path, now: i64) -> Option<(Option<i64>, Vec<UsageWindow>)> {
    let body: Value = serde_json::from_str(&fs::read_to_string(dir.join(USAGE_FILE)).ok()?).ok()?;
    let seconds = |v: &Value| v.as_f64().map(|n| n as i64);
    let window = |key: &str, kind: &str, label: &str| {
        let w = &body[key];
        let window = UsageWindow {
            kind: kind.into(),
            label: label.into(),
            used_percent: w["used_percentage"].as_f64()?,
            resets_at: seconds(&w["resets_at"]),
            resets_text: None,
        };
        Some(window.as_of(now))
    };
    let windows: Vec<UsageWindow> = [
        window("fiveHour", "session", "5-hour"),
        window("sevenDay", "weekly", "Weekly"),
    ]
    .into_iter()
    .flatten()
    .collect();
    (!windows.is_empty()).then(|| (seconds(&body["updatedAt"]), windows))
}
