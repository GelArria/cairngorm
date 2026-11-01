//! Removes what Cairngorm wrote into other agents' configurations: the session hooks and
//! their script, the Pi and OpenCode session plugins, and the Claude Code status line relay.
//! Every other entry is kept; an unreadable config is reported, never rewritten. A marker
//! stops Cairngorm from adding them back on its own until the user restores them.
use crate::agent_integrations::{
    hook_targets, opencode_dir, pi_dir, real_env, EnvLookup, HookLayout,
};
use crate::integration_config::{remove_plugin, write_config};
use serde_json::Value;
use std::{collections::HashSet, fs, path::Path};

const MARKER: &str = ".panel/agent/agent-hooks-removed";
const SCRIPT: &str = "cairngorm-session.";

/// The user removed Cairngorm from agent configs and has not restored it.
pub fn removed(home: &Path) -> bool {
    home.join(MARKER).exists()
}

/// Records the user's choice; restoring deletes the marker so the next terminal reinstalls.
pub fn set_removed(home: &Path, removed: bool) -> Result<(), String> {
    let marker = home.join(MARKER);
    if removed {
        fs::create_dir_all(marker.parent().ok_or("missing parent")?).map_err(|e| e.to_string())?;
        fs::write(
            &marker,
            "Cairngorm will not add its agent hooks until restored.\n",
        )
        .map_err(|e| e.to_string())
    } else {
        remove_file(&marker)
    }
}

/// Removes every Cairngorm hook, plugin file and status line relay. Each result names one
/// agent configuration that could not be cleaned.
pub fn remove(home: &Path, claude_dirs: &[std::path::PathBuf]) -> Vec<Result<(), String>> {
    let mut results = Vec::new();
    // Folder overrides may differ from when the hooks were written (the uninstaller does not
    // see shell-profile variables), so the default folders are cleaned as well.
    let defaults = |_: &str| None;
    let lookups: [EnvLookup; 2] = [&real_env, &defaults];
    let mut seen = HashSet::new();
    for env in lookups {
        let pi = pi_dir(home, env);
        if seen.insert(pi.clone()) {
            results.push(remove_file(&pi.join("extensions/cairngorm-session.ts")));
        }
        let opencode = opencode_dir(home, env);
        if seen.insert(opencode.clone()) {
            results.push(remove_opencode(&opencode));
        }
        for (dir, file, _, layout) in hook_targets(home, env) {
            let config = dir.join(&file);
            if !seen.insert(config.clone()) {
                continue;
            }
            // Copilot and Grok read a hooks file that only Cairngorm writes.
            let cleaned = if file.ends_with("cairngorm.json") {
                remove_file(&config)
            } else {
                remove_hooks(&config, layout)
            };
            // A config that still lists the hook keeps its script, or the agent reports a
            // missing hook on every session.
            if cleaned.is_ok() {
                for name in ["cairngorm-session.ps1", "cairngorm-session.py"] {
                    results.push(remove_file(&dir.join("hooks").join(name)));
                }
            }
            results.push(cleaned);
        }
    }
    for dir in claude_dirs {
        results.push(crate::claude_statusline::uninstall(dir));
    }
    results
}

fn remove_opencode(dir: &Path) -> Result<(), String> {
    for (file, key, plugin) in [
        ("tui.json", "plugin", "./cairngorm-session.js"),
        ("tui.jsonc", "plugin", "./cairngorm-session.js"),
        ("cli.json", "plugins", "./cairngorm-session"),
    ] {
        let path = dir.join(file);
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let updated =
            remove_plugin(&text, key, plugin).map_err(|e| format!("{}: {e}", path.display()))?;
        if updated != text {
            write_config(&path, &updated)?;
        }
    }
    remove_file(&dir.join("cairngorm-session.js"))?;
    remove_file(&dir.join("cairngorm-session/tui.js"))?;
    // Fails when not empty (the user put something there) or missing: either way, keep going.
    let _ = fs::remove_dir(dir.join("cairngorm-session"));
    Ok(())
}

/// Drops hook entries that run the session script; other hooks stay as they are.
pub(crate) fn remove_hooks(config: &Path, layout: HookLayout) -> Result<(), String> {
    let Ok(text) = fs::read_to_string(config) else {
        return Ok(());
    };
    let mut value: Value =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", config.display()))?;
    let Some(hooks) = value.get_mut("hooks").and_then(Value::as_object_mut) else {
        return Ok(());
    };
    let ours = |entry: &Value| {
        ["command", "powershell", "bash"]
            .iter()
            .filter_map(|key| entry[*key].as_str())
            .any(|command| command.contains(SCRIPT))
    };
    let mut any = false;
    let mut emptied = Vec::new();
    for (event, entries) in hooks.iter_mut() {
        let Some(entries) = entries.as_array_mut() else {
            continue;
        };
        let before = entries.len();
        let mut changed = false;
        if let HookLayout::Nested { .. } = layout {
            entries.retain_mut(|group| {
                let Some(inner) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                    return true;
                };
                let count = inner.len();
                inner.retain(|hook| !ours(hook));
                changed |= inner.len() != count;
                // A group left without hooks was Cairngorm's own.
                !(inner.is_empty() && count > 0)
            });
        } else {
            entries.retain(|entry| !ours(entry));
        }
        changed |= entries.len() != before;
        // Only an event Cairngorm emptied is removed; the user's own empty lists stay.
        if changed && entries.is_empty() {
            emptied.push(event.clone());
        }
        any |= changed;
    }
    if !any {
        return Ok(());
    }
    for event in &emptied {
        hooks.remove(event);
    }
    write_config(
        config,
        &serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?,
    )
}

fn remove_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("{}: {e}", path.display()))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
#[path = "../../../tests/native/agent-cleanup.rs"]
mod tests;
