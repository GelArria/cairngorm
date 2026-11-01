use crate::{
    ai_cli,
    ai_detection::{detect, AiService},
    ai_runtime::AiRuntime,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, sync::Mutex};

// Serialize runtime and selection changes, including across mounted views.
static SELECTION: Mutex<()> = Mutex::new(());

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationConfig {
    pub setup_complete: bool,
    pub commit_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) claude_api_consent: Option<crate::claude_api::ClaudeApiConsent>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub runtimes: BTreeMap<String, AiRuntime>,
}

impl IntegrationConfig {
    pub(crate) fn runtime(&self, id: &str) -> AiRuntime {
        self.runtimes.get(id).cloned().unwrap_or_default()
    }
}

fn config_path() -> std::path::PathBuf {
    ai_cli::home().join(".panel/agent/integrations.json")
}

pub(crate) fn read_config() -> Result<IntegrationConfig, String> {
    read_config_at(&config_path())
}

pub(crate) fn read_config_at(path: &Path) -> Result<IntegrationConfig, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(raw.trim_start_matches('\u{feff}'))
            .map_err(|_| "Invalid integrations config. Fix it before saving.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(IntegrationConfig::default()),
        Err(_) => Err("Could not read integrations config.".into()),
    }
}

pub(crate) fn selected_cli() -> Result<Option<(String, AiRuntime)>, String> {
    let cfg = read_config_at(&config_path())?;
    if claude_consent_required(&cfg) {
        return Ok(None);
    }
    match &cfg.commit_provider {
        Some(id) if matches!(id.as_str(), "codex" | "claude" | "gemini") => {
            Ok(Some((id.clone(), cfg.runtime(id))))
        }
        Some(_) => Err("Unknown AI integration. Open Settings → AI providers.".into()),
        None => Ok(None),
    }
}

#[cfg(test)]
pub(crate) fn selected_provider() -> Result<Option<String>, String> {
    selected_cli().map(|selected| selected.map(|(id, _)| id))
}

pub(crate) fn claude_consent_required(cfg: &IntegrationConfig) -> bool {
    cfg.commit_provider.as_deref() == Some("claude") && !has_claude_consent(cfg)
}
fn has_claude_consent(cfg: &IntegrationConfig) -> bool {
    cfg.claude_api_consent
        .as_ref()
        .is_some_and(|c| c.matches(&cfg.runtime("claude")))
}
pub(crate) fn require_selected_consent() -> Result<(), String> {
    if claude_consent_required(&read_config()?) {
        return Err(crate::claude_api::CONSENT_REQUIRED.into());
    }
    Ok(())
}

fn save(cfg: &IntegrationConfig) -> Result<(), String> {
    let path = config_path();
    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|_| "Could not create integrations config.")?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?,
    )
    .map_err(|_| "Could not save integrations config.")?;
    let result =
        std::fs::rename(&tmp, &path).map_err(|_| "Could not replace integrations config.".into());
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationView {
    #[serde(flatten)]
    config: IntegrationConfig,
    services: Vec<AiService>,
    claude_consent_required: bool,
    claude_api_consent_granted: bool,
}

fn view(mut config: IntegrationConfig) -> Result<IntegrationView, String> {
    let claude_consent_required = claude_consent_required(&config);
    let claude_api_consent_granted = has_claude_consent(&config);
    if claude_consent_required {
        config.commit_provider = None;
    }
    let runtime = config.runtime("codex");
    let codex = std::thread::spawn(move || detect("codex", runtime));
    let runtime = config.runtime("gemini");
    let gemini = std::thread::spawn(move || detect("gemini", runtime));
    let claude = detect("claude", config.runtime("claude"));
    let codex = codex.join().map_err(|_| "Codex detection failed.")?;
    let gemini = gemini.join().map_err(|_| "Gemini CLI detection failed.")?;
    Ok(IntegrationView {
        config,
        services: vec![codex, claude, gemini],
        claude_consent_required,
        claude_api_consent_granted,
    })
}

#[tauri::command]
pub async fn detect_ai_services() -> Result<IntegrationView, String> {
    crate::blocking(|| view(read_config_at(&config_path())?)).await?
}

#[tauri::command]
pub async fn save_ai_runtime(
    id: String,
    mut runtime: AiRuntime,
) -> Result<IntegrationView, String> {
    crate::blocking(move || {
        let _selection = SELECTION
            .lock()
            .map_err(|_| "Integration selection is unavailable.")?;
        runtime.validate(&id)?;
        let mut cfg = read_config_at(&config_path())?;
        // A different executable or account directory must be verified before reuse.
        if cfg.runtime(&id) != runtime && cfg.commit_provider.as_deref() == Some(&id) {
            cfg.commit_provider = None;
        }
        if id == "claude" && cfg.runtime(&id) != runtime {
            cfg.claude_api_consent = None;
        }
        cfg.runtimes.insert(id, runtime);
        save(&cfg)?;
        view(cfg)
    })
    .await?
}

#[tauri::command]
pub async fn connect_ai_service(id: String, acknowledgement: Option<String>) -> Result<(), String> {
    crate::blocking(move || {
        if !matches!(id.as_str(), "codex" | "claude" | "gemini") {
            return Err("Unknown AI integration.".into());
        }
        let _selection = SELECTION
            .lock()
            .map_err(|_| "Integration selection is unavailable.")?;
        let mut cfg = read_config_at(&config_path())?;
        let runtime = cfg.runtime(&id);
        let service = detect(&id, runtime.clone());
        if service.status != "session-detected" {
            return Err(service.message);
        }
        let reply = ai_cli::request(
            &id,
            &runtime,
            "Reply with exactly CAIRNGORM_OK. Do not use tools.".into(),
            acknowledgement.as_deref(),
        )?;
        if reply != "CAIRNGORM_OK" {
            return Err(
                "CLI did not return the verification response. No integration was changed.".into(),
            );
        }
        cfg.claude_api_consent = if id == "claude" {
            Some(crate::claude_api::ClaudeApiConsent::new(&runtime))
        } else {
            None
        };
        cfg.commit_provider = Some(id);
        cfg.setup_complete = true;
        save(&cfg)
    })
    .await?
}

#[tauri::command]
pub async fn finish_ai_setup(use_api: bool) -> Result<(), String> {
    crate::blocking(move || {
        let _selection = SELECTION
            .lock()
            .map_err(|_| "Integration selection is unavailable.")?;
        let mut cfg = read_config_at(&config_path())?;
        cfg.setup_complete = true;
        if use_api {
            cfg.commit_provider = None;
            cfg.claude_api_consent = None;
        }
        save(&cfg)
    })
    .await?
}

#[tauri::command]
pub async fn needs_ai_setup() -> Result<bool, String> {
    crate::blocking(|| {
        read_config_at(&config_path()).map(|c| !c.setup_complete || claude_consent_required(&c))
    })
    .await?
}
