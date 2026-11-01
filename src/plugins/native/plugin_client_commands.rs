use super::{bridge, clients, plugins_dir, state, PluginsState};
use std::path::PathBuf;
use tauri::AppHandle;

#[tauri::command]
pub async fn plugins_add_client(
    app: AppHandle,
    name: String,
    config_path: PathBuf,
    format: clients::ClientFormat,
) -> Result<PluginsState, String> {
    crate::blocking(move || {
        let dir = plugins_dir(&app)?;
        let canonical = std::fs::canonicalize(&config_path).map_err(|e| e.to_string())?;
        for target in super::agent_targets::targets(&bridge::home(), &bridge::env) {
            if std::fs::canonicalize(&target.file).ok().as_ref() == Some(&canonical) {
                return Err(format!("This configuration is already managed for {}. Use Check agent connections instead.", target.name));
            }
        }
        clients::add(&dir, name, config_path, format)?;
        Ok(state(&dir, None))
    }).await?
}

#[tauri::command]
pub async fn plugins_set_client_connected(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<PluginsState, String> {
    crate::blocking(move || {
        let dir = plugins_dir(&app)?;
        if enabled {
            bridge::serve(&app, &dir)?;
        }
        clients::connect(&dir, &id, &bridge::bridge_path(&dir), enabled)?;
        Ok(state(&dir, None))
    })
    .await?
}

#[tauri::command]
pub async fn plugins_remove_client(app: AppHandle, id: String) -> Result<PluginsState, String> {
    crate::blocking(move || {
        let dir = plugins_dir(&app)?;
        clients::forget(&dir, &id, &bridge::bridge_path(&dir))?;
        Ok(state(&dir, None))
    })
    .await?
}
