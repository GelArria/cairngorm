//! Local applications share the plugin catalog, but never fake a remote endpoint. Whether
//! agents can use one comes from app discovery (its COM server or its own MCP server), never
//! from a per-application adapter.
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub installed: bool,
    pub can_edit: bool,
    pub connected: bool,
    /// "com" or "mcp" when agents can drive it.
    pub driver: Option<&'static str>,
    pub message: String,
}

/// Installed without an automation API agents can use (e.g. LibreOffice's `soffice`).
fn executable(id: &str) -> Option<PathBuf> {
    if !id.starts_with("libreoffice-") {
        return None;
    }
    crate::cli_catalog::find_program("soffice")
        .or_else(|| {
            ["ProgramFiles", "ProgramFiles(x86)"]
                .iter()
                .filter_map(std::env::var_os)
                .map(|base| PathBuf::from(base).join("LibreOffice/program/soffice.exe"))
                .find(|path| path.is_file())
        })
        .or_else(|| {
            let mac = PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice");
            mac.is_file().then_some(mac)
        })
}

pub fn availability(id: &str) -> Availability {
    let app = super::app_discovery::for_catalog(id);
    let driver = app.as_ref().map(|app| app.driver());
    let installed = app.is_some() || executable(id).is_some();
    let message = match driver {
        Some("mcp") => "Installed. Agents use it through its own MCP server; its window opens in a pane beside the terminal.",
        Some(_) => "Installed. Agents use it through its own automation API; its window opens in a pane beside the terminal.",
        None if installed => "Installed, but it offers no automation API Cairngorm can use.",
        None => "Not found on this computer. Install it separately; Cairngorm never installs applications.",
    };
    Availability {
        installed,
        can_edit: driver.is_some(),
        connected: driver.is_some(),
        driver,
        message: message.into(),
    }
}
