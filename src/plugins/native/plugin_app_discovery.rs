//! Installed applications agents can drive through their own automation API. On Windows
//! these are COM servers registered as `<Name>.Application` whose executable exists outside
//! the Windows folder (Excel, Word, PowerPoint, Outlook, Photoshop, AutoCAD…), plus catalog
//! applications that ship their own MCP server (`app_mcp`). Nothing here is per-application:
//! whatever the user installs shows up.
use super::app_mcp::McpServer;
use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct App {
    /// Stable id agents pass back, e.g. "excel".
    pub id: String,
    pub name: String,
    /// COM ProgID ("" when the application is driven through its own MCP server).
    pub prog_id: String,
    /// The program the user sees (its window is shown in panes).
    pub executable: String,
    #[serde(skip)]
    pub mcp: Option<McpServer>,
}

impl App {
    /// How agents drive it: its own MCP server (`cairngorm_app_call`), or this platform's
    /// automation through `cairngorm_app_script`: COM on Windows, Apple events on macOS.
    pub fn driver(&self) -> &'static str {
        if self.mcp.is_some() {
            "mcp"
        } else if cfg!(windows) {
            "com"
        } else if cfg!(target_os = "macos") {
            "osa"
        } else {
            "none"
        }
    }
}

const REFRESH: Duration = Duration::from_secs(300);
/// Registered automation servers that are system components, not applications.
const SKIP: &[&str] = &["internetexplorer", "mmc20", "msgraph", "shell", "wscript"];

static CACHE: Mutex<Option<(Instant, Vec<App>)>> = Mutex::new(None);

/// The discovered applications, refreshed at most every five minutes (or when asked).
/// The scan runs without the cache lock held, and a failed scan keeps the last good list.
/// Detected applications with `cairngorm.json`'s `applications` section applied.
pub fn apps(refresh: bool) -> Vec<App> {
    super::app_settings::with_config(detected(refresh), &crate::config::section("applications"))
}

/// What Windows registers, before cairngorm.json (consent keys compare against it).
pub fn detected(refresh: bool) -> Vec<App> {
    let cached = CACHE.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some((at, apps)) = &cached {
        if !refresh && at.elapsed() < REFRESH {
            return apps.clone();
        }
    }
    match scan() {
        Some(apps) => {
            let apps = with_mcp(apps);
            *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), apps.clone()));
            apps
        }
        // Applications with their own MCP server need nothing from the COM scan.
        None => cached
            .map(|(_, apps)| apps)
            .unwrap_or_else(|| with_mcp(Vec::new())),
    }
}

fn with_mcp(mut apps: Vec<App>) -> Vec<App> {
    for app in super::app_mcp::installed() {
        if !apps.iter().any(|known| known.id == app.id) {
            apps.push(app);
        }
    }
    apps
}

pub fn find(id: &str) -> Option<App> {
    apps(false).into_iter().find(|app| app.id == id)
}

/// The application behind a catalog entry: the same id, or else a detected application whose
/// id follows the entry's vendor prefix ("microsoft-word" is the registered "word"). Ids added
/// in cairngorm.json never stand in for another catalog entry.
pub fn for_catalog(catalog_id: &str) -> Option<App> {
    let apps = apps(false);
    if let Some(app) = apps.iter().find(|app| app.id == catalog_id) {
        return Some(app.clone());
    }
    let detected = detected(false);
    apps.into_iter()
        .find(|app| matches_catalog(catalog_id, &app.id) && detected.iter().any(|d| d == app))
}

pub(super) fn matches_catalog(catalog_id: &str, app_id: &str) -> bool {
    !app_id.is_empty()
        && (catalog_id == app_id
            || catalog_id
                .strip_suffix(app_id)
                .is_some_and(|vendor| vendor.len() > 1 && vendor.ends_with('-')))
}

/// `Excel.Application.16` → "excel"; unversioned ProgIDs win over versioned ones.
pub(super) fn from_entries(entries: Vec<(String, String, String)>) -> Vec<App> {
    let mut apps: Vec<App> = Vec::new();
    let windows = std::env::var("WINDIR")
        .unwrap_or_else(|_| r"C:\Windows".into())
        .to_ascii_lowercase();
    for (prog_id, executable, description) in entries {
        // Case-insensitive, like the registry: "Foo.application" is "foo".
        let Some(end) = prog_id.to_ascii_lowercase().find(".application") else {
            continue;
        };
        let prefix = &prog_id[..end];
        let id = prefix.to_ascii_lowercase();
        if id.is_empty()
            || SKIP.contains(&id.as_str())
            || executable.to_ascii_lowercase().starts_with(&windows)
        {
            continue;
        }
        let versioned = prog_id.len() > prefix.len() + ".Application".len();
        if let Some(existing) = apps.iter_mut().find(|app| app.id == id) {
            if !versioned {
                existing.prog_id = prog_id;
                existing.executable = executable;
            }
            continue;
        }
        let prefix = prefix.to_string();
        let name = if description.trim().is_empty() {
            prefix.clone()
        } else {
            description.trim().to_string()
        };
        apps.push(App {
            id,
            name,
            prog_id,
            executable,
            mcp: None,
        });
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[cfg(windows)]
fn scan() -> Option<Vec<App>> {
    use std::os::windows::process::CommandExt;
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = foreach ($key in Get-ChildItem 'Registry::HKEY_CLASSES_ROOT') {
  $name = $key.PSChildName
  if ($name -notmatch '^[A-Za-z][\w]*\.Application(\.\d+)?$') { continue }
  $clsid = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$name\CLSID").'(default)'
  if (-not $clsid) { continue }
  $server = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\LocalServer32").'(default)'
  if (-not $server) { $server = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\WOW6432Node\CLSID\$clsid\LocalServer32").'(default)' }
  if (-not $server) { continue }
  $exe = if ($server.StartsWith('"')) { $server.Split('"')[1] } else { ($server -split ' /| -')[0].Trim() }
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { continue }
  @{ progId = $name; exe = $exe; description = (Get-Item -LiteralPath $exe).VersionInfo.FileDescription }
}
ConvertTo-Json -Compress -InputObject @($out)
"#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .creation_flags(0x0800_0000)
        .output();
    let output = output.ok().filter(|o| o.status.success())?;
    let rows: Vec<serde_json::Value> = serde_json::from_slice(&output.stdout).ok()?;
    Some(from_entries(
        rows.iter()
            .filter_map(|row| {
                Some((
                    row["progId"].as_str()?.to_string(),
                    row["exe"].as_str()?.to_string(),
                    row["description"].as_str().unwrap_or_default().to_string(),
                ))
            })
            .collect(),
    ))
}

/// macOS: every application bundle with a scripting dictionary.
#[cfg(target_os = "macos")]
fn scan() -> Option<Vec<App>> {
    Some(super::app_osa::scan())
}

/// Linux has no common automation interface; applications with their own MCP server remain.
#[cfg(not(any(windows, target_os = "macos")))]
fn scan() -> Option<Vec<App>> {
    Some(Vec::new())
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_discovery.rs"]
mod tests;
