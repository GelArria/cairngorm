//! Registers the stdio bridge with each installed agent CLI. One entry serves every
//! plugin, so enabling another plugin never touches agent configuration again.
use super::agent_targets::{targets, Env, Format, Style, Target};
use super::config_edit;
use crate::integration_config::write_config;
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, path::Path};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistration {
    pub id: &'static str,
    pub name: &'static str,
    pub config_path: String,
    pub registered: bool,
    pub error: Option<String>,
    /// Seconds since this agent last called the gateway from a Cairngorm terminal.
    pub last_seen: Option<u64>,
    pub activity: Option<super::activity::ClientActivity>,
}

pub(super) fn entry(style: Style, command: &str, args: &[&str]) -> Value {
    match style {
        Style::Stdio => json!({ "command": command, "args": args }),
        Style::TypedStdio => json!({ "type": "stdio", "command": command, "args": args }),
        Style::Copilot => {
            json!({ "type": "local", "command": command, "args": args, "tools": ["*"] })
        }
        Style::OpenCode => {
            let command: Vec<_> = std::iter::once(command)
                .chain(args.iter().copied())
                .collect();
            json!({ "type": "local", "command": command, "enabled": true })
        }
    }
}

/// Whether the config runs this install's bridge; another install's entry is an error.
pub(super) fn registration_entry(format: Format, text: &str) -> Result<Option<Value>, String> {
    let text = text.trim_start_matches('\u{feff}');
    Ok(match format {
        Format::Json(_, _) if text.trim().is_empty() => None,
        Format::Json(parent, _) => {
            let clean = crate::integration_config::clean_jsonc(text);
            let value: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
            let root = value.as_object().ok_or("config must be an object")?;
            match root.get(parent) {
                Some(servers) => servers
                    .as_object()
                    .ok_or_else(|| format!("{parent} must be an object"))?
                    .get(config_edit::SERVER)
                    .cloned(),
                None => None,
            }
        }
        Format::Toml if text.trim().is_empty() => None,
        Format::Toml => config_edit::toml_server(text)?
            .map(|entry| serde_json::to_value(entry).map_err(|e| e.to_string()))
            .transpose()?,
    })
}

pub(super) fn registered(format: Format, text: &str, bridge: &str) -> Result<bool, String> {
    match registration_entry(format, text)? {
        None => Ok(false),
        Some(entry) if config_edit::runs_bridge(&entry, bridge) => {
            if entry["enabled"] == false
                || entry["disabled"] == true
                || entry["exposure"] == "hidden"
            {
                return Err(
                    "The cairngorm MCP server is disabled in this agent's configuration".into(),
                );
            }
            Ok(true)
        }
        Some(_) => Err("Another install already registered a \"cairngorm\" server here".into()),
    }
}

pub(super) fn read(file: &Path) -> Result<String, String> {
    match fs::read_to_string(file) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn report(target: &Target, registered: bool, error: Option<String>) -> AgentRegistration {
    AgentRegistration {
        id: target.id,
        name: target.name,
        config_path: target.file.to_string_lossy().into_owned(),
        registered,
        error,
        last_seen: None,
        activity: None,
    }
}

/// Installed agents only: a missing configuration folder means the CLI is not set up.
pub fn status(home: &Path, env: Env, bridge: &str) -> Vec<AgentRegistration> {
    targets(home, env)
        .iter()
        .filter(|t| t.installed())
        .map(
            |t| match read(&t.file).and_then(|text| registered(t.format, &text, bridge)) {
                Ok(ours) => report(t, ours, None),
                Err(error) => report(t, false, Some(error)),
            },
        )
        .collect()
}

pub fn register(home: &Path, env: Env, command: &str, bridge: &str) -> Vec<AgentRegistration> {
    targets(home, env)
        .iter()
        .filter(|t| t.installed())
        .map(|t| {
            match register_one(
                &t.file,
                t.format,
                command,
                &[bridge],
                visibility_defaults(t).as_ref(),
            ) {
                Ok(()) => report(t, true, None),
                // An unreadable, invalid or foreign entry is reported, never overwritten.
                Err(error) => report(t, false, Some(error)),
            }
        })
        .collect()
}

fn visibility_defaults(target: &Target) -> Option<Value> {
    if target.id != "pi" {
        return None;
    }
    let mut defaults = json!({"description": super::context::DESCRIPTION});
    if target
        .file
        .file_name()
        .is_some_and(|name| name == "mcp-adapter.json")
    {
        defaults["directTools"] = json!(true);
        defaults["lifecycle"] = json!("keep-alive");
    } else {
        defaults["exposure"] = json!("direct");
    }
    Some(defaults)
}

pub(super) fn register_one(
    file: &Path,
    format: Format,
    command: &str,
    args: &[&str],
    defaults: Option<&Value>,
) -> Result<(), String> {
    let text = read(file)?;
    let registered = registered(format, &text, args[0])?;
    if registered && defaults.is_none() {
        return Ok(());
    }
    let updated = super::mcp_servers::edit_keeping_bom(&text, |body| match format {
        Format::Json(parent, _) if registered => config_edit::add_json_defaults(
            body,
            parent,
            defaults.ok_or("Missing discovery defaults")?,
        ),
        Format::Json(parent, style) => {
            let mut value = entry(style, command, args);
            if let Some(defaults) = defaults.and_then(Value::as_object) {
                value
                    .as_object_mut()
                    .ok_or("Invalid MCP entry")?
                    .extend(defaults.clone());
            }
            config_edit::add_json_server(body, parent, &value)
        }
        Format::Toml => config_edit::add_toml_args(body, command, args),
    })?;
    if updated == text {
        return Ok(());
    }
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_config(file, &updated)
}

/// Node runs the bridge for most agents; Bun is the fallback for Bun-only machines.
pub fn runtime() -> Option<String> {
    if which::which("node").is_ok() {
        return Some("node".into());
    }
    which::which("bun")
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}
