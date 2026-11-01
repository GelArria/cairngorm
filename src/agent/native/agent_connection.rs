use super::{credentials, try_read_config, valid_env_name, validate_base_url};
use serde::Serialize;
use std::time::Duration;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTestResult {
    ok: bool,
    message: String,
    models: Vec<String>,
}

fn fail(message: impl Into<String>) -> AgentTestResult {
    AgentTestResult {
        ok: false,
        message: message.into(),
        models: vec![],
    }
}

/// GET {baseUrl}/models with the given key (or the saved / env one). OpenAI-style
/// `{data:[{id}]}` and Ollama-style `{models:[{name}]}` lists are both understood.
/// A saved key only ever goes to the base URL and key environment it was saved
/// for. The HTTP `/models` probe is available for HTTP(S) endpoints only.
#[tauri::command(async)]
pub fn test_agent_connection(
    base_url: String,
    api_key_env: String,
    api_key: Option<String>,
    use_saved: Option<bool>,
    provider: Option<String>,
) -> AgentTestResult {
    let base = match validate_base_url(&base_url) {
        Ok(base) => base,
        Err(message) => return fail(message),
    };
    let scheme = tauri::Url::parse(&base)
        .map(|url| url.scheme().to_string())
        .unwrap_or_default();
    if matches!(scheme.as_str(), "ws" | "wss") {
        return fail("WebSocket endpoints cannot be tested with the HTTP /models check.");
    }
    if !valid_env_name(api_key_env.trim()) {
        return fail("Key variable must look like OPENAI_API_KEY (A–Z, 0–9, _).");
    }
    let cfg = match try_read_config() {
        Ok(cfg) => cfg,
        Err(message) => return fail(message),
    };
    let same_target = cfg
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_end_matches('/'))
        == Some(base.as_str())
        && cfg.get("apiKeyEnv").and_then(|v| v.as_str()).map(str::trim) == Some(api_key_env.trim())
        && provider.as_deref().map(str::trim) == cfg.get("provider").and_then(|v| v.as_str());
    let stored = use_saved.unwrap_or(true) && same_target;
    let saved_key = if stored {
        match credentials::read(&cfg) {
            Ok(key) => key,
            Err(message) => return fail(message),
        }
    } else {
        None
    };
    let key = api_key
        .filter(|k| !k.trim().is_empty())
        .or(saved_key)
        .or_else(|| {
            std::env::var(api_key_env.trim())
                .ok()
                .filter(|s| !s.is_empty())
        });
    let url = format!("{base}/models");
    let agent = match crate::http_transport::agent_builder(&url) {
        Ok(builder) => builder,
        Err(message) => return fail(message),
    }
    .redirects(0)
    .timeout(Duration::from_secs(10))
    .build();
    let mut req = agent.get(&url);
    if let Some(k) = &key {
        req = req.set("Authorization", &format!("Bearer {}", k.trim()));
    }
    match req.call() {
        Ok(resp) => {
            let body: serde_json::Value = resp.into_json().unwrap_or(serde_json::Value::Null);
            let list = body["data"]
                .as_array()
                .or_else(|| body["models"].as_array());
            let mut models: Vec<String> = list
                .map(|a| {
                    a.iter()
                        .filter_map(|m| {
                            m["id"]
                                .as_str()
                                .or_else(|| m["name"].as_str())
                                .map(String::from)
                        })
                        .take(300)
                        .collect()
                })
                .unwrap_or_default();
            models.sort();
            let message = if models.is_empty() {
                "Connected.".to_string()
            } else {
                format!("Connected · {} models", models.len())
            };
            AgentTestResult {
                ok: true,
                message,
                models,
            }
        }
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => {
            fail(if key.is_some() {
                "The provider rejected the API key."
            } else {
                "This provider needs an API key."
            })
        }
        Err(ureq::Error::Status(404, _)) => {
            fail("No /models endpoint at this base URL — check it (most end in /v1).")
        }
        Err(ureq::Error::Status(code, _)) => fail(format!("The provider answered HTTP {code}.")),
        Err(e) => fail(format!("Could not reach the provider: {}", e.kind())),
    }
}
