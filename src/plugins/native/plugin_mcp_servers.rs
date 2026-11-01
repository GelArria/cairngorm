//! Every MCP server the installed agent CLIs are configured with, user-wide and for the
//! active project, plus add/remove edits that keep each config's formatting.
use super::agent_targets::{targets, Env, Format, Style, Target};
use super::config_edit::SERVER;
use super::{mcp_edit, mcp_redact as redact};
use crate::integration_config::{clean_jsonc, write_config, write_config_with};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path, path::PathBuf};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub agent: &'static str,
    pub agent_name: &'static str,
    pub name: String,
    /// "user" (all projects), "local" (this project, private) or "project" (shared file).
    pub scope: &'static str,
    pub transport: String,
    /// Command line or URL.
    pub target: String,
    pub config_path: String,
    pub enabled: bool,
    /// Cairngorm's own plugin bridge; managed from Plugins.
    pub managed: bool,
}

/// One config file and where its server list lives.
struct Source {
    agent: &'static str,
    agent_name: &'static str,
    scope: &'static str,
    file: PathBuf,
    /// JSON key path to the server object; empty for Codex TOML.
    path: Vec<String>,
    toml: bool,
    style: Option<Style>,
}

fn describe(entry: &Value) -> (String, String, bool) {
    let get = |k: &str| entry.get(k).and_then(Value::as_str);
    let enabled = entry.get("enabled").and_then(Value::as_bool) != Some(false)
        && entry.get("disabled").and_then(Value::as_bool) != Some(true);
    if let Some(url) = get("url").or(get("httpUrl")).or(get("serverUrl")) {
        let kind = match get("type") {
            Some("sse") => "sse",
            _ => "http",
        };
        return (kind.into(), redact::redact_url(url), enabled);
    }
    let mut parts: Vec<String> = match entry.get("command") {
        Some(Value::String(c)) => vec![c.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        _ => Vec::new(),
    };
    if let Some(Value::Array(args)) = entry.get("args") {
        parts.extend(args.iter().filter_map(|v| v.as_str().map(String::from)));
    }
    (
        "stdio".into(),
        redact::redact_args(&parts).join(" "),
        enabled,
    )
}

/// A leading byte-order mark, which both parsers reject.
const BOM: char = '\u{feff}';

fn read_entries(source: &Source) -> Vec<(String, Value)> {
    let Ok(raw) = fs::read_to_string(&source.file) else {
        return Vec::new();
    };
    let text = raw.trim_start_matches(BOM);
    let root: Option<Value> = if source.toml {
        toml::from_str::<toml::Value>(text)
            .ok()
            .and_then(|v| serde_json::to_value(v.get("mcp_servers")?).ok())
    } else {
        serde_json::from_str::<Value>(&clean_jsonc(text))
            .ok()
            .and_then(|mut v| {
                for key in &source.path {
                    v = v.get(key)?.clone();
                }
                Some(v)
            })
    };
    match root {
        Some(Value::Object(map)) => map.into_iter().collect(),
        _ => Vec::new(),
    }
}

/// Claude Code keys local servers by the project folder as it was opened.
fn claude_project_key(file: &Path, project: &str) -> Option<String> {
    let text = fs::read_to_string(file).ok()?;
    let value: Value = serde_json::from_str(&clean_jsonc(text.trim_start_matches(BOM))).ok()?;
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let wanted = norm(project);
    value
        .get("projects")?
        .as_object()?
        .keys()
        .find(|k| norm(k) == wanted)
        .cloned()
}

fn sources(home: &Path, env: Env, project: Option<&str>) -> Vec<Source> {
    let mut out = Vec::new();
    let installed: Vec<Target> = targets(home, env)
        .into_iter()
        .filter(|t| t.installed())
        .collect();
    for t in &installed {
        let (path, toml, style) = match t.format {
            Format::Json(parent, style) => (vec![parent.to_string()], false, Some(style)),
            Format::Toml => (Vec::new(), true, None),
        };
        let source = |scope, file: PathBuf, path: Vec<String>| Source {
            agent: t.id,
            agent_name: t.name,
            scope,
            file,
            path,
            toml,
            style,
        };
        out.push(source("user", t.file.clone(), path.clone()));
        let Some(project) = project else {
            continue;
        };
        let dir = Path::new(project);
        match t.id {
            "claude" => {
                if let Some(key) = claude_project_key(&t.file, project) {
                    let path = vec!["projects".into(), key, "mcpServers".into()];
                    out.push(source("local", t.file.clone(), path));
                }
                out.push(source("project", dir.join(".mcp.json"), path));
            }
            "codex" => out.push(source(
                "project",
                dir.join(".codex").join("config.toml"),
                path,
            )),
            "cursor" => out.push(source(
                "project",
                dir.join(".cursor").join("mcp.json"),
                path,
            )),
            "gemini" => out.push(source(
                "project",
                dir.join(".gemini").join("settings.json"),
                path,
            )),
            "opencode" => out.push(source("project", dir.join("opencode.json"), path)),
            _ => {}
        }
    }
    // A project opened at the home folder would list user files a second time.
    let user_files: Vec<PathBuf> = out
        .iter()
        .filter(|s| s.scope == "user")
        .map(|s| s.file.clone())
        .collect();
    out.retain(|s| s.scope != "project" || !user_files.contains(&s.file));
    out
}

/// Apply `edit` to the text after any byte-order mark, and put the mark back.
pub(super) fn edit_keeping_bom(
    text: &str,
    edit: impl FnOnce(&str) -> Result<String, String>,
) -> Result<String, String> {
    let body = text.trim_start_matches(BOM);
    let bom = &text[..text.len() - body.len()];
    Ok(format!("{bom}{}", edit(body)?))
}

pub fn list(home: &Path, env: Env, project: Option<&str>) -> Vec<McpServer> {
    let mut servers = Vec::new();
    for source in sources(home, env, project) {
        for (name, entry) in read_entries(&source) {
            let (transport, target, enabled) = describe(&entry);
            servers.push(McpServer {
                agent: source.agent,
                agent_name: source.agent_name,
                managed: name == SERVER && target.contains("mcp-bridge.cjs"),
                name,
                scope: source.scope,
                transport,
                target,
                config_path: source.file.to_string_lossy().into_owned(),
                enabled,
            });
        }
    }
    servers
}

pub fn remove(
    home: &Path,
    env: Env,
    project: Option<&str>,
    agent: &str,
    scope: &str,
    name: &str,
) -> Result<(), String> {
    let source = sources(home, env, project)
        .into_iter()
        .find(|s| s.agent == agent && s.scope == scope)
        .ok_or("This configuration is not available")?;
    let text = fs::read_to_string(&source.file).map_err(|e| e.to_string())?;
    let path: Vec<&str> = source.path.iter().map(String::as_str).collect();
    let updated = edit_keeping_bom(&text, |body| {
        if source.toml {
            mcp_edit::remove_toml(body, name)
        } else {
            mcp_edit::remove_json(body, &path, name)
        }
    })?;
    // Project files get no backup beside them; see `write_config_with`.
    write_config_with(&source.file, &updated, source.scope != "project")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewServer {
    pub name: String,
    /// "stdio" or "http".
    pub transport: String,
    pub command: String,
    pub args: Vec<String>,
    pub url: String,
}

fn json_entry(agent: &str, style: Style, s: &NewServer) -> Value {
    if s.transport == "http" {
        return match (agent, style) {
            ("gemini", _) => json!({ "httpUrl": s.url }),
            (_, Style::OpenCode) => json!({ "type": "remote", "url": s.url, "enabled": true }),
            (_, Style::Copilot) => json!({ "type": "http", "url": s.url, "tools": ["*"] }),
            (_, Style::TypedStdio) => json!({ "type": "http", "url": s.url }),
            (_, Style::Stdio) => json!({ "url": s.url }),
        };
    }
    match style {
        Style::Stdio => json!({ "command": s.command, "args": s.args }),
        Style::TypedStdio => json!({ "type": "stdio", "command": s.command, "args": s.args }),
        Style::Copilot => {
            json!({ "type": "local", "command": s.command, "args": s.args, "tools": ["*"] })
        }
        Style::OpenCode => {
            let mut command = vec![s.command.clone()];
            command.extend(s.args.iter().cloned());
            json!({ "type": "local", "command": command, "enabled": true })
        }
    }
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Adds a user-wide server to each chosen agent; returns one error per failed agent.
pub fn add(home: &Path, env: Env, agents: &[String], server: &NewServer) -> Vec<(String, String)> {
    let mut failures = Vec::new();
    if !valid_name(&server.name) {
        failures.push((
            "all".into(),
            "Use letters, digits, - or _ in the name".into(),
        ));
        return failures;
    }
    let ready = if server.transport == "http" {
        server.url.starts_with("http://") || server.url.starts_with("https://")
    } else {
        !server.command.trim().is_empty()
    };
    if !ready {
        failures.push(("all".into(), "Enter a command, or an http(s) URL".into()));
        return failures;
    }
    for source in sources(home, env, None) {
        if !agents.iter().any(|a| a == source.agent) {
            continue;
        }
        let result = (|| {
            let text = match fs::read_to_string(&source.file) {
                Ok(text) => text,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
                Err(e) => return Err(e.to_string()),
            };
            let updated = edit_keeping_bom(&text, |body| match source.style {
                None if server.transport == "http" => {
                    mcp_edit::add_toml(body, &server.name, &[("url", json!(server.url))])
                }
                None => mcp_edit::add_toml(
                    body,
                    &server.name,
                    &[
                        ("command", json!(server.command)),
                        ("args", json!(server.args)),
                    ],
                ),
                Some(style) => {
                    let entry = json_entry(source.agent, style, server);
                    mcp_edit::add_json(body, &source.path[0], &server.name, &entry)
                }
            })?;
            if let Some(dir) = source.file.parent() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            write_config(&source.file, &updated)
        })();
        if let Err(error) = result {
            failures.push((source.agent_name.to_string(), error));
        }
    }
    failures
}

fn home_env() -> (PathBuf, impl Fn(&str) -> Option<std::ffi::OsString>) {
    (super::bridge::home(), super::bridge::env)
}

#[tauri::command]
pub async fn mcp_servers_list(project: Option<String>) -> Result<McpInventory, String> {
    crate::blocking(move || {
        let (home, env) = home_env();
        inventory(&home, &env, project.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn mcp_server_remove(
    project: Option<String>,
    agent: String,
    scope: String,
    name: String,
) -> Result<McpInventory, String> {
    crate::blocking(move || {
        let (home, env) = home_env();
        if name == SERVER {
            return Err("Cairngorm's plugin server is managed from Plugins".into());
        }
        remove(&home, &env, project.as_deref(), &agent, &scope, &name)?;
        Ok(inventory(&home, &env, project.as_deref()))
    })
    .await?
}

/// Errors are returned per agent so one unreadable config never blocks the others.
#[tauri::command]
pub async fn mcp_server_add(
    agents: Vec<String>,
    server: NewServer,
) -> Result<Vec<(String, String)>, String> {
    crate::blocking(move || {
        let (home, env) = home_env();
        add(&home, &env, &agents, &server)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAgent {
    pub id: &'static str,
    pub name: &'static str,
    pub config_path: String,
}

#[derive(Serialize)]
pub struct McpInventory {
    pub servers: Vec<McpServer>,
    /// Installed agent CLIs, including those without any server yet.
    pub agents: Vec<McpAgent>,
}

pub fn inventory(home: &Path, env: Env, project: Option<&str>) -> McpInventory {
    let agents = targets(home, env)
        .into_iter()
        .filter(|t| t.installed())
        .map(|t| McpAgent {
            id: t.id,
            name: t.name,
            config_path: t.file.to_string_lossy().into_owned(),
        })
        .collect();
    McpInventory {
        servers: list(home, env, project),
        agents,
    }
}
