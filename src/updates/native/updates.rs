//! Self-update from GitHub releases built on the release repository's `main`.
//! Not active until the release channel is published. To activate:
//! 1. `npx tauri signer generate` — keep the private key in CI secrets;
//! 2. build releases with updater artifacts so each installer gets `<asset>.sig`;
//! 3. set `PUBLIC_KEY` below to the generated public key and `CHANNEL.enabled = true`.
//!
//! An installer runs only after its minisign signature verifies against that key.
#[path = "./updates_install.rs"]
mod install;
#[path = "./updates_release.rs"]
mod release;

use serde::Serialize;
use std::time::Duration;
use tauri::Manager;

pub struct Channel {
    /// `owner/name` of the public release repository.
    pub repo: &'static str,
    /// Releases are taken only when they point at this branch.
    pub branch: &'static str,
    pub enabled: bool,
}

/// The public release channel. Not posted yet: checks report "not active".
pub const CHANNEL: Channel = Channel {
    repo: "GelArria/Cairngorm",
    branch: "main",
    enabled: false,
};

/// Base64 minisign public key from `tauri signer generate` (empty until published).
pub const PUBLIC_KEY: &str = "";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    /// "disabled" | "current" | "available"
    pub state: &'static str,
    pub current: String,
    pub repo: String,
    pub branch: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub page: Option<String>,
    /// This system can install it in place (Windows, signed installer); otherwise the page opens.
    pub installable: bool,
    /// A verified installer is already staged and waits for the app to exit.
    pub ready: bool,
}

/// The proxy route is chosen for `url`; GitHub's download redirects keep that route.
fn agent(url: &str) -> Result<ureq::Agent, String> {
    Ok(crate::http_transport::agent_builder(url)?
        .https_only(true)
        .timeout_connect(Duration::from_secs(10))
        .user_agent(concat!("Cairngorm/", env!("CARGO_PKG_VERSION")))
        .build())
}

fn current() -> semver::Version {
    semver::Version::parse(env!("CARGO_PKG_VERSION")).expect("crate version is semver")
}

fn latest() -> Result<Option<release::Release>, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases?per_page=30",
        CHANNEL.repo
    );
    let releases: serde_json::Value = agent(&url)?
        .get(&url)
        .set("accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Could not reach the release channel: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    Ok(release::pick_release(
        &releases,
        CHANNEL.branch,
        release::installer_suffixes(),
    ))
}

pub fn check() -> Result<UpdateCheck, String> {
    let mut status = UpdateCheck {
        state: "disabled",
        current: current().to_string(),
        repo: CHANNEL.repo.into(),
        branch: CHANNEL.branch.into(),
        version: None,
        notes: None,
        page: None,
        installable: false,
        ready: install::has_pending(),
    };
    if !CHANNEL.enabled {
        return Ok(status);
    }
    status.state = "current";
    if let Some(found) = latest()?.filter(|r| r.version > current()) {
        status.state = "available";
        status.installable = cfg!(windows)
            && !PUBLIC_KEY.is_empty()
            && found.asset.is_some()
            && found.signature_url.is_some();
        status.version = Some(found.version.to_string());
        status.notes = Some(found.notes);
        status.page = Some(found.page);
    }
    Ok(status)
}

fn fetch(url: &str, timeout: u64) -> Result<ureq::Response, String> {
    if !release::trusted_url(url) {
        return Err("The release points outside GitHub; nothing was downloaded".into());
    }
    agent(url)?
        .get(url)
        .timeout(Duration::from_secs(timeout))
        .call()
        .map_err(|e| format!("Download failed: {e}"))
}

/// Downloads and verifies the installer; it runs once Cairngorm closes normally.
fn prepare() -> Result<(), String> {
    if !CHANNEL.enabled {
        return Err("Automatic updates are not active yet".into());
    }
    if !cfg!(windows) {
        return Err("In-place install is Windows-only; download it from the release page".into());
    }
    let _guard = install::InstallGuard::acquire()?;
    // Re-read the release here: never trust a URL handed over by the webview.
    let found = latest()?.ok_or("No release is available")?;
    // The signature proves the installer came from the release key, not which version it
    // is: a re-tagged older signed installer would downgrade. That needs control of the
    // release repository (Tauri's own updater has the same limit).
    if found.version <= current() {
        return Err("Cairngorm is already up to date".into());
    }
    let (_, url) = found
        .asset
        .ok_or("This release has no installer for this system")?;
    let signature_url = found
        .signature_url
        .ok_or("This release has no installer signature")?;
    let signature = fetch(&signature_url, 20)?
        .into_string()
        .map_err(|e| e.to_string())?;
    let bytes = install::read_bounded(fetch(&url, 600)?.into_reader())?;
    install::verify_signature(&bytes, &signature, PUBLIC_KEY)?;
    install::set_pending(install::stage(&bytes, ".exe")?, signature);
    Ok(())
}

#[tauri::command]
pub async fn update_check() -> Result<UpdateCheck, String> {
    crate::blocking(check).await?
}

#[tauri::command]
pub async fn update_install() -> Result<(), String> {
    crate::blocking(prepare).await?
}

/// Closes the main window the usual way (unsaved changes are asked about); the
/// verified installer starts once it is gone. Cancelling the close keeps it waiting.
#[tauri::command]
pub fn update_restart(app: tauri::AppHandle) -> Result<(), String> {
    if !install::has_pending() {
        return Err("No verified update is ready".into());
    }
    app.get_webview_window("main")
        .ok_or("The main window is not open")?
        .close()
        .map_err(|e| e.to_string())
}

/// Whether closing the main window should end the app so the installer can run.
pub fn has_pending() -> bool {
    install::has_pending()
}

/// From the app's exit event: start the verified installer, if one is staged.
pub fn launch_pending() {
    install::launch_pending(PUBLIC_KEY);
}

#[cfg(test)]
#[path = "../../../tests/native/updates.rs"]
mod tests;
