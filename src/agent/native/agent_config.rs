#[path = "agent_connection.rs"]
mod connection;
pub use connection::*;
// BYOK: read / write the agent's provider settings in ~/.panel/agent/config.json
// (the same file get_agent_env and the agent sidecar read) and test them against
// the provider. The UI never receives the full API key — only where it comes
// from and its last 4 characters.
use serde::{Deserialize, Serialize};

#[path = "agent_credentials.rs"]
pub(crate) mod credentials;
#[path = "agent_endpoint.rs"]
mod endpoint;
#[path = "agent_config_store.rs"]
mod store;
pub use endpoint::{is_loopback_url, validate_base_url};
static CONFIG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn try_read_config() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| "Agent configuration is busy")?;
    store::read()
}

fn str_of(cfg: &serde_json::Map<String, serde_json::Value>, k: &str, default: &str) -> String {
    cfg.get(k)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
        .to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigView {
    provider: String,
    model: String,
    base_url: String,
    api_key_env: String,
    /** "saved" (OS vault) | "env" (environment variable) | "none" */
    key_source: String,
    /** last 4 characters of the effective key */
    key_hint: Option<String>,
}

fn view(cfg: &serde_json::Map<String, serde_json::Value>) -> Result<AgentConfigView, String> {
    let api_key_env = str_of(cfg, "apiKeyEnv", "OPENAI_API_KEY");
    let saved = credentials::read(cfg)?;
    let configured = !str_of(cfg, "model", "").trim().is_empty()
        && !str_of(cfg, "baseUrl", "").trim().is_empty();
    let env = configured
        .then(|| std::env::var(&api_key_env).ok())
        .flatten()
        .filter(|s| !s.is_empty());
    let (key_source, key) = match (saved, env) {
        (Some(k), _) => ("saved", Some(k)),
        (None, Some(k)) => ("env", Some(k)),
        _ => ("none", None),
    };
    Ok(AgentConfigView {
        provider: str_of(cfg, "provider", "openai"),
        model: str_of(cfg, "model", ""),
        base_url: str_of(cfg, "baseUrl", ""),
        api_key_env,
        key_source: key_source.into(),
        // Short values (placeholders, typos) are never echoed, not even partly
        key_hint: key.filter(|k| k.chars().count() >= 8).map(|k| {
            k.chars()
                .rev()
                .take(4)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        }),
    })
}

#[tauri::command(async)]
pub fn get_agent_config() -> Result<AgentConfigView, String> {
    view(&try_read_config()?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigInput {
    provider: String,
    model: String,
    base_url: String,
    api_key_env: String,
    /** None = keep only for the same target; Some("") = remove; Some(key) = replace. */
    api_key: Option<String>,
    /** local servers: the agent gets a placeholder key */
    #[serde(default)]
    key_optional: bool,
}

fn valid_env_name(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_uppercase() || c == '_')
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn target_changed(
    cfg: &serde_json::Map<String, serde_json::Value>,
    provider: &str,
    base_url: &str,
    api_key_env: &str,
) -> bool {
    let old_provider = str_of(cfg, "provider", "");
    let old_base_url = str_of(cfg, "baseUrl", "").trim_end_matches('/').to_string();
    let old_key_env = str_of(cfg, "apiKeyEnv", "OPENAI_API_KEY");
    old_provider != provider || old_base_url != base_url || old_key_env != api_key_env
}

#[tauri::command(async)]
pub fn save_agent_config(input: AgentConfigInput) -> Result<AgentConfigView, String> {
    let model = input.model.trim();
    let base_url = validate_base_url(&input.base_url)?;
    let api_key_env = input.api_key_env.trim();
    if model.is_empty() {
        return Err("Model is required.".into());
    }
    if !valid_env_name(api_key_env) {
        return Err("Key variable must look like OPENAI_API_KEY (A–Z, 0–9, _).".into());
    }
    // Keep everything else (profiles, thinking level…) untouched
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| "Agent configuration is busy")?;
    let mut cfg = store::read()?;
    let old_ref = cfg
        .get("apiKeyRef")
        .and_then(|v| v.as_str())
        .map(String::from);
    let mut new_ref = None;
    let changed = target_changed(&cfg, input.provider.trim(), &base_url, api_key_env);
    cfg.insert("provider".into(), input.provider.trim().into());
    cfg.insert("model".into(), model.into());
    cfg.insert("baseUrl".into(), base_url.into());
    cfg.insert("apiKeyEnv".into(), api_key_env.into());
    if input.key_optional {
        cfg.insert("keyOptional".into(), true.into());
    } else {
        cfg.remove("keyOptional");
    }
    match input.api_key.as_deref().map(str::trim) {
        Some("") => {
            cfg.remove("apiKey");
            cfg.remove("apiKeyRef");
        }
        Some(k) => {
            new_ref = Some(credentials::save(&mut cfg, k)?);
        }
        None if changed => {
            // A saved key belongs to its original provider and endpoint. Never
            // silently send it to a newly selected destination.
            cfg.remove("apiKey");
            cfg.remove("apiKeyRef");
        }
        None => {}
    }
    if let Err(error) = store::write(&cfg) {
        if let Some(id) = new_ref {
            credentials::delete(&id);
        }
        return Err(error);
    }
    if let Some(id) =
        old_ref.filter(|id| cfg.get("apiKeyRef").and_then(|v| v.as_str()) != Some(id.as_str()))
    {
        credentials::delete(&id);
    }
    view(&cfg)
}

#[cfg(test)]
#[path = "../../../tests/native/agent-config.rs"]
mod tests;
