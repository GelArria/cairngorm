//! macOS: applications are driven through Apple events, the same object model AppleScript
//! uses. Every application bundle that declares a scripting dictionary
//! (`NSAppleScriptEnabled` or `OSAScriptingDefinition` in its Info.plist) is listed, and an
//! agent's script runs as JavaScript for Automation with `app` bound to it. Nothing here is
//! per-application. macOS asks the user once per application before Cairngorm may control it.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use super::app_discovery::App;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Default)]
struct Info {
    #[serde(rename = "CFBundleIdentifier")]
    bundle_id: Option<String>,
    #[serde(rename = "CFBundleDisplayName")]
    display_name: Option<String>,
    #[serde(rename = "CFBundleName")]
    name: Option<String>,
    #[serde(rename = "CFBundleExecutable")]
    executable: Option<String>,
    #[serde(rename = "NSAppleScriptEnabled")]
    script_enabled: Option<plist::Value>,
    #[serde(rename = "OSAScriptingDefinition")]
    dictionary: Option<String>,
}

/// "com.microsoft.Word" → "word": the id agents pass back. A generic last part keeps the one
/// before it ("com.figma.Desktop" → "figma-desktop").
pub(super) fn short_id(bundle_id: &str) -> String {
    const GENERIC: &[&str] = &[
        "app",
        "application",
        "client",
        "desktop",
        "id",
        "mac",
        "macos",
    ];
    let clean = |part: &str| {
        part.chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect::<String>()
            .to_ascii_lowercase()
    };
    let mut parts = bundle_id.rsplit('.');
    let last = clean(parts.next().unwrap_or(bundle_id));
    match parts.next() {
        Some(before) if GENERIC.contains(&last.as_str()) => format!("{}-{last}", clean(before)),
        _ => last,
    }
}

/// The application in `bundle`, when it can be scripted.
fn from_info(bundle: &Path, info: Info) -> Option<App> {
    let enabled = match &info.script_enabled {
        Some(plist::Value::Boolean(on)) => *on,
        Some(plist::Value::String(text)) => text.eq_ignore_ascii_case("yes"),
        _ => false,
    };
    if !enabled && info.dictionary.is_none() {
        return None;
    }
    let bundle_id = info.bundle_id?;
    let id = short_id(&bundle_id);
    let executable = bundle.join("Contents/MacOS").join(info.executable?);
    let name = info
        .display_name
        .or(info.name)
        .or_else(|| bundle.file_stem().map(|s| s.to_string_lossy().into_owned()))?;
    (!id.is_empty()).then(|| App {
        id,
        name,
        prog_id: bundle_id,
        executable: executable.to_string_lossy().into(),
        mcp: None,
    })
}

/// Scriptable applications in `folders` (each `.app` directly inside one). An id two
/// applications share is told apart by its full bundle identifier.
pub(super) fn scan_folders(folders: &[PathBuf]) -> Vec<App> {
    let mut apps: Vec<App> = Vec::new();
    for folder in folders {
        let Ok(entries) = std::fs::read_dir(folder) else {
            continue;
        };
        // Directory order is arbitrary; which bundle keeps a shared id must not be.
        let mut bundles: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
        bundles.sort();
        for bundle in bundles {
            if bundle.extension().is_none_or(|e| e != "app") {
                continue;
            }
            let Ok(info) = plist::from_file::<_, Info>(bundle.join("Contents/Info.plist")) else {
                continue;
            };
            let Some(mut app) = from_info(&bundle, info) else {
                continue;
            };
            if apps.iter().any(|known| known.prog_id == app.prog_id) {
                continue;
            }
            if apps.iter().any(|known| known.id == app.id) {
                app.id = app.prog_id.to_ascii_lowercase().replace('.', "-");
            }
            apps.push(app);
        }
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

pub(super) fn scan() -> Vec<App> {
    let mut folders: Vec<PathBuf> = [
        "/Applications",
        "/Applications/Utilities",
        "/System/Applications",
        "/System/Applications/Utilities",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    if let Some(home) = std::env::var_os("HOME") {
        folders.push(PathBuf::from(home).join("Applications"));
    }
    scan_folders(&folders)
}

/// The JavaScript for Automation program: `app` is the application, `started` tells whether
/// it was not running before, and `print(...)` writes a line to the result.
pub(super) fn wrap(app: &App, script: &str) -> String {
    let bundle = serde_json::to_string(&app.prog_id).unwrap_or_else(|_| "\"\"".into());
    format!(
        "ObjC.import('Foundation');\n\
function print(...values) {{\n\
  const text = values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ') + '\\n';\n\
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(text).dataUsingEncoding($.NSUTF8StringEncoding));\n\
}}\n\
const started = !Application({bundle}).running();\n\
const app = Application({bundle});\n\
app.includeStandardAdditions = true;\n\
(function () {{\n{script}\n}})();\n\
'';\n"
    )
}

#[cfg(target_os = "macos")]
pub(super) fn run(
    app: &App,
    script: &str,
    cwd: &Path,
    budget: super::app_script::Budget,
) -> Result<serde_json::Value, String> {
    let file = std::env::temp_dir().join(format!("cairngorm-app-{}.js", uuid::Uuid::new_v4()));
    std::fs::write(&file, wrap(app, script)).map_err(|e| e.to_string())?;
    let mut command = std::process::Command::new("/usr/bin/osascript");
    command
        .args(["-l", "JavaScript"])
        .arg(&file)
        .current_dir(cwd);
    let finished = super::app_run::supervise(command, app, budget.left);
    let _ = std::fs::remove_file(&file);
    Ok(super::app_run::report(app, finished?, budget.limit))
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_osa.rs"]
mod tests;
