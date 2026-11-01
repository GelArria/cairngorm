//! User-registered MCP clients. No executable discovery or client-specific code is required.
use super::{
    agent_targets::{Format, Style},
    agents, bridge, config_edit, mcp_edit,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientFormat {
    Json,
    TypedJson,
    OpenCode,
    Copilot,
    Toml,
}

impl ClientFormat {
    fn config(self) -> Format {
        match self {
            Self::Json => Format::Json("mcpServers", Style::Stdio),
            Self::TypedJson => Format::Json("mcpServers", Style::TypedStdio),
            Self::OpenCode => Format::Json("mcp", Style::OpenCode),
            Self::Copilot => Format::Json("mcpServers", Style::Copilot),
            Self::Toml => Format::Toml,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Client {
    pub id: String,
    pub name: String,
    pub config_path: PathBuf,
    pub format: ClientFormat,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStatus {
    #[serde(flatten)]
    pub client: Client,
    pub registered: bool,
    pub error: Option<String>,
    pub activity: Option<super::activity::ClientActivity>,
}

fn read(dir: &Path) -> Result<Vec<Client>, String> {
    match fs::read_to_string(dir.join("clients.json")) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn save(dir: &Path, clients: &[Client]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(clients).map_err(|e| e.to_string())?;
    bridge::write_private(&dir.join("clients.json"), &text)
}

pub fn list(dir: &Path, script: &str) -> Result<Vec<ClientStatus>, String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    Ok(read(dir)?
        .into_iter()
        .map(|client| {
            let result = agents::read(&client.config_path).and_then(|text| {
                let ours = owned(&client, &text, script)?;
                if ours {
                    agents::registered(client.format.config(), &text, script)
                } else {
                    Ok(false)
                }
            });
            let (registered, error) = match result {
                Ok(on) => (on, None),
                Err(e) => (false, Some(e)),
            };
            ClientStatus {
                client,
                registered,
                error,
                activity: None,
            }
        })
        .collect())
}

/// Register only: the user enables the connection separately with the row's switch.
pub fn add(
    dir: &Path,
    name: String,
    config_path: PathBuf,
    format: ClientFormat,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Use a client name between 1 and 80 characters".into());
    }
    if !config_path.is_absolute() || !config_path.is_file() {
        return Err("Select an existing MCP configuration file with an absolute path".into());
    }
    let extension = config_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default();
    let valid_extension = match format {
        ClientFormat::Toml => extension == "toml",
        _ => matches!(extension, "json" | "jsonc"),
    };
    if !valid_extension {
        return Err(
            "Select a JSON/JSONC or TOML configuration matching the selected format".into(),
        );
    }
    let path = fs::canonicalize(&config_path).map_err(|e| e.to_string())?;
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let mut clients = read(dir)?;
    if clients.iter().any(|c| c.config_path == path) {
        return Err("This configuration is already registered".into());
    }
    // Parse and validate without writing the selected file or running its commands.
    agents::registered(
        format.config(),
        &agents::read(&path)?,
        "not-a-cairngorm-bridge",
    )?;
    clients.push(Client {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        config_path: path,
        format,
    });
    save(dir, &clients)
}

fn owned(client: &Client, text: &str, script: &str) -> Result<bool, String> {
    let Some(entry) = agents::registration_entry(client.format.config(), text)? else {
        return Ok(false);
    };
    let args = entry["args"]
        .as_array()
        .or_else(|| entry["command"].as_array());
    let ours = args.is_some_and(|args| {
        args.windows(3)
            .any(|a| a[0] == script && a[1] == "--client" && a[2] == client.id)
    });
    if !ours {
        return Err(
            "The cairngorm entry belongs to another connection; it was left unchanged".into(),
        );
    }
    Ok(true)
}

pub fn connect(dir: &Path, id: &str, script: &str, on: bool) -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let client = read(dir)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or("Unknown MCP client")?;
    if on {
        let text = agents::read(&client.config_path)?;
        owned(&client, &text, script)?;
        let runtime = agents::runtime().ok_or("Install Node.js or Bun to connect MCP clients")?;
        agents::register_one(
            &client.config_path,
            client.format.config(),
            &runtime,
            &[script, "--client", id],
            None,
        )?;
    } else {
        let text = agents::read(&client.config_path)?;
        // Removal must not delete a server another application put under the same name.
        if !owned(&client, &text, script)? {
            return Err(
                "This client does not contain its Cairngorm connection; nothing was removed".into(),
            );
        }
        remove_connection(&client, &text)?;
    }
    super::catalog::changed();
    Ok(())
}

fn remove_connection(client: &Client, text: &str) -> Result<(), String> {
    let updated =
        super::mcp_servers::edit_keeping_bom(text, |body| match client.format.config() {
            Format::Json(parent, _) => mcp_edit::remove_json(body, &[parent], config_edit::SERVER),
            Format::Toml => mcp_edit::remove_toml(body, config_edit::SERVER),
        })?;
    crate::integration_config::write_config(&client.config_path, &updated)
}

pub fn forget(dir: &Path, id: &str, script: &str) -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let mut clients = read(dir)?;
    let client = clients
        .iter()
        .find(|c| c.id == id)
        .ok_or("Unknown MCP client")?;
    let text = agents::read(&client.config_path)?;
    if owned(client, &text, script).unwrap_or(false) {
        remove_connection(client, &text)?;
    }
    clients.retain(|c| c.id != id);
    save(dir, &clients)?;
    super::catalog::changed();
    Ok(())
}
