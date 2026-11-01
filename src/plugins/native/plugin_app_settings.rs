//! `cairngorm.json`'s `applications` section. The file can hide detected applications and add
//! ones Windows does not register as `<Name>.Application`, but it can never borrow an approval:
//! an added application cannot reuse a detected id (even a hidden one), must name an absolute
//! program outside the Windows folder, and is approved under its own key (id + ProgID +
//! program), so changing what it points to asks the user again.
use super::app_discovery::App;
use sha2::{Digest, Sha256};
use std::path::Path;

/// Automation servers that are system components, never applications.
const SYSTEM: &[&str] = &[
    "internetexplorer",
    "mmc20",
    "msgraph",
    "shell",
    "wscript",
    "wscript.shell",
];

fn windows_dir() -> String {
    std::env::var("WINDIR")
        .unwrap_or_else(|_| r"C:\Windows".into())
        .to_ascii_lowercase()
        .replace('/', "\\")
}

fn valid_added(id: &str, name: &str, prog_id: &str, executable: &str) -> bool {
    let id_ok = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-');
    let prog_ok = !prog_id.is_empty()
        && prog_id.len() <= 128
        && prog_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_')
        && !SYSTEM.iter().any(|system| {
            let prog = prog_id.to_ascii_lowercase();
            prog == *system || prog.starts_with(&format!("{system}."))
        });
    let name_ok =
        !name.is_empty() && name.chars().count() <= 64 && !name.chars().any(char::is_control);
    let path = Path::new(executable);
    let exe_ok = path.is_absolute()
        && path.is_file()
        && !executable
            .to_ascii_lowercase()
            .replace('/', "\\")
            .starts_with(&windows_dir());
    id_ok && prog_ok && name_ok && exe_ok
}

/// `hide` removes detected ids; `add` declares extra applications (see module docs).
pub(super) fn with_config(mut apps: Vec<App>, section: &serde_json::Value) -> Vec<App> {
    let detected: Vec<String> = apps.iter().map(|app| app.id.clone()).collect();
    let hidden: Vec<&str> = section["hide"]
        .as_array()
        .map(|ids| ids.iter().filter_map(|id| id.as_str()).collect())
        .unwrap_or_default();
    apps.retain(|app| !hidden.contains(&app.id.as_str()));
    for added in section["add"].as_array().into_iter().flatten() {
        let text = |key: &str| added[key].as_str().unwrap_or_default().trim().to_string();
        let (id, name, prog_id, executable) =
            (text("id"), text("name"), text("progId"), text("executable"));
        if !valid_added(&id, &name, &prog_id, &executable)
            || detected.contains(&id)
            || apps.iter().any(|app| app.id == id)
        {
            continue;
        }
        apps.push(App {
            id,
            name,
            prog_id,
            executable,
            mcp: None,
        });
    }
    apps
}

/// The key an approval for `app` is stored under. Detected applications keep their id (so
/// existing approvals stay valid); added ones include what they point to.
pub(super) fn consent_key(app: &App, detected: &[App]) -> String {
    if detected.iter().any(|d| d == app) {
        // macOS ids come from bundle identifiers another bundle could share: the approval
        // names the bundle, so a newly installed one never inherits it.
        if cfg!(target_os = "macos") && app.mcp.is_none() {
            return format!("{}@{}", app.id, app.prog_id);
        }
        return app.id.clone();
    }
    let digest = Sha256::digest(
        format!("{}\0{}", app.prog_id, app.executable.to_ascii_lowercase()).as_bytes(),
    );
    format!("{}#{:x}", app.id, digest)[..app.id.len() + 13].to_string()
}

/// The name shown when asking: an added application says where it comes from.
pub(super) fn consent_label(app: &App, detected: &[App]) -> String {
    if detected.iter().any(|d| d == app) {
        app.name.clone()
    } else {
        format!("{} (from cairngorm.json)", app.name)
    }
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_settings.rs"]
mod tests;
