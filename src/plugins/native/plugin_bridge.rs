//! The stdio bridge agents run: kept current on disk, served by the gateway and
//! registered with each installed agent CLI.
use super::{agents, gateway};
use std::{fs, path::Path, path::PathBuf};
use tauri::AppHandle;

const BRIDGE: &str = include_str!("../assets/mcp-bridge.cjs");

pub fn home() -> PathBuf {
    PathBuf::from(crate::shells::home_dir())
}

pub fn env(name: &str) -> Option<std::ffi::OsString> {
    std::env::var_os(name)
}

/// Atomic write readable only by this user: the gateway file holds its secret.
pub(crate) fn write_private(path: &Path, text: &str) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("missing parent")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// The bridge path as written in agent configs. Forward slashes keep it literal in
/// every config syntax, Windows included.
pub fn bridge_path(dir: &Path) -> String {
    dir.join("mcp-bridge.cjs")
        .to_string_lossy()
        .replace('\\', "/")
}

/// Serve and refresh the bridge script. Agent configs are not touched here.
pub fn serve(app: &AppHandle, dir: &Path) -> Result<(), String> {
    gateway::ensure(app, dir.to_path_buf())?;
    let bridge = dir.join("mcp-bridge.cjs");
    if fs::read_to_string(&bridge).ok().as_deref() != Some(BRIDGE) {
        write_private(&bridge, BRIDGE)?;
    }
    Ok(())
}

/// Enabling a plugin: serve, then register the bridge with installed agents. Only this
/// explicit action edits agent configs, so a user who removes the entry keeps it removed.
pub fn activate(app: &AppHandle, dir: &Path) -> Result<(), String> {
    serve(app, dir)?;
    if !super::catalog::agents_connected(dir) {
        return Err("Connect plugins to your agents first".into());
    }
    let command = agents::runtime().ok_or("Plugins need Node.js or Bun to connect agents")?;
    agents::register(&home(), &env, &command, &bridge_path(dir));
    Ok(())
}
