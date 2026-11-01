//! Handpicked MCP servers that Cairngorm can connect. Only these servers are ever contacted.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

/// Every entry is off until the user adds it in Settings ▸ Plugins. A new entry needs the
/// service's official remote MCP server (no sign-in, or OAuth with dynamic client
/// registration), its logo in `public/plugins/` and a line in `public/plugins/NOTICE.txt`.
const CATALOG_JSON: &str = include_str!("../assets/catalog.json");

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Auth {
    /// The server answers anyone.
    #[default]
    None,
    /// The user signs in once in the browser; Cairngorm registers itself as an OAuth client.
    OAuth,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// Catalog shelf the plugin is listed under.
    pub category: &'static str,
    /// The service's own logo, bundled under `public/plugins/` (never fetched at runtime).
    pub logo: &'static str,
    /// Streamable HTTP endpoint of the service's official MCP server.
    #[serde(default)]
    pub server_url: &'static str,
    /// Local integrations never contact a fabricated remote MCP endpoint.
    #[serde(default)]
    pub local_app: bool,
    pub homepage: &'static str,
    pub terms: &'static str,
    /// CSS added to the plugin's view so it fits a Cairngorm pane. Views are built for chat
    /// hosts; this adapts layout only and never changes what the view does.
    #[serde(default)]
    pub view_css: &'static str,
    #[serde(default)]
    pub auth: Auth,
    /// A document provider shipped with Cairngorm that opens this application's files in panes.
    #[serde(default)]
    pub document_provider: &'static str,
    /// Command line of the application's own MCP server on stdio (program, then arguments),
    /// e.g. "photocraft-cli mcp". The program is looked up where the application is installed.
    #[serde(default)]
    pub mcp: &'static str,
}

/// Strings are borrowed from the embedded JSON, so they must not contain escapes; the
/// catalog test parses it, so a bad entry fails the build's tests rather than at startup.
pub fn catalog() -> &'static [PluginSpec] {
    static CATALOG: OnceLock<Vec<PluginSpec>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let parsed = || -> Result<Vec<PluginSpec>, serde_json::Error> {
            let mut catalog: Vec<PluginSpec> = serde_json::from_str(CATALOG_JSON)?;
            catalog.extend(serde_json::from_str::<Vec<PluginSpec>>(include_str!(
                "../assets/application-catalog.json"
            ))?);
            Ok(catalog)
        };
        parsed().unwrap_or_else(|e| {
            eprintln!("[plugins] invalid catalog: {e}");
            Vec::new()
        })
    })
}

pub fn find(id: &str) -> Option<&'static PluginSpec> {
    catalog().iter().find(|plugin| plugin.id == id)
}

#[derive(Default, Deserialize, Serialize)]
struct PluginSettings {
    #[serde(default)]
    enabled: Vec<String>,
    #[serde(default)]
    agents_connected: bool,
    #[serde(default)]
    files_enabled: bool,
    /// The user turned file tools off; otherwise the first use asks.
    #[serde(default)]
    files_declined: bool,
    /// Applications the user always allows agents to script, each in one project. Global
    /// `apps_always` grants from older builds are ignored and dropped on the next save, so
    /// their next use asks again.
    #[serde(default)]
    app_grants: Vec<AppGrant>,
}

/// "Always allow" for one application (id from app discovery) in one project.
#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppGrant {
    pub app: String,
    pub project_id: String,
}

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
static REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn revision() -> u64 {
    REVISION.load(std::sync::atomic::Ordering::SeqCst)
}

pub fn changed() {
    REVISION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

pub fn settings_path(dir: &std::path::Path) -> PathBuf {
    dir.join("settings.json")
}

/// Unknown ids from older or newer builds are ignored, never contacted.
pub fn enabled(dir: &std::path::Path) -> Vec<&'static PluginSpec> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(dir)
        .unwrap_or_default()
        .enabled
        .iter()
        .filter_map(|id| find(id))
        .collect()
}

pub fn agents_connected(dir: &std::path::Path) -> bool {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(dir).unwrap_or_default().agents_connected
}

pub fn files_enabled(dir: &std::path::Path) -> bool {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(dir).is_ok_and(|s| s.files_enabled)
}

/// "ask" (default: the first use asks), "always" or "off".
pub fn files_access(dir: &std::path::Path) -> &'static str {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match read(dir) {
        Ok(s) if s.files_enabled => "always",
        Ok(s) if s.files_declined => "off",
        _ => "ask",
    }
}

/// File tools are offered (asking first unless always allowed).
pub fn files_offered(dir: &std::path::Path) -> bool {
    files_access(dir) != "off"
}

pub fn set_files_access(dir: &std::path::Path, access: &str) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = read(dir)?;
    settings.files_enabled = access == "always";
    settings.files_declined = access == "off";
    save(dir, &settings)?;
    changed();
    Ok(())
}

pub fn app_grants(dir: &std::path::Path) -> Vec<AppGrant> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(dir).map(|s| s.app_grants).unwrap_or_default()
}

pub fn set_app_grant(dir: &std::path::Path, grant: &AppGrant, always: bool) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = read(dir)?;
    settings.app_grants.retain(|g| g != grant);
    if always {
        settings.app_grants.push(grant.clone());
    }
    save(dir, &settings)?;
    changed();
    Ok(())
}

/// Consent is separate from plugin selection and is never inferred from an old config.
pub fn connect_agents(dir: &std::path::Path) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = read(dir)?;
    settings.agents_connected = true;
    save(dir, &settings)
}

/// The bridge was taken out of agent configs: file tools stop until agents connect again.
pub fn disconnect_agents(dir: &std::path::Path) -> Result<(), String> {
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = read(dir)?;
    if !settings.agents_connected {
        return Ok(());
    }
    settings.agents_connected = false;
    save(dir, &settings)?;
    changed();
    Ok(())
}

pub fn set_enabled(dir: &std::path::Path, id: &str, on: bool) -> Result<(), String> {
    find(id).ok_or("Unknown plugin")?;
    let _guard = SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut settings = read(dir)?;
    settings.enabled.retain(|existing| existing != id);
    if on {
        settings.enabled.push(id.to_string());
    }
    save(dir, &settings)?;
    changed();
    Ok(())
}

fn save(dir: &std::path::Path, settings: &PluginSettings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    super::bridge::write_private(&settings_path(dir), &text)
}

fn read(dir: &std::path::Path) -> Result<PluginSettings, String> {
    match fs::read_to_string(settings_path(dir)) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(PluginSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}
