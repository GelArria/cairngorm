//! Main-app-only control plane; agent bridges and embedded views cannot grant file access.
use super::{
    file_consent::ConsentDecision,
    file_permissions::Decision,
    file_runtime::{runtime, TerminalFileScope},
    PluginsState,
};
use tauri::{AppHandle, WebviewWindow};

pub(super) fn require_main(window: &WebviewWindow) -> Result<(), String> {
    require_label(window.label())
}
fn require_label(label: &str) -> Result<(), String> {
    if label != "main" {
        return Err("Only the main app window can manage file access.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn plugins_sync_workspace(
    window: WebviewWindow,
    terminals: Vec<TerminalFileScope>,
    dirty_paths: Vec<String>,
) -> Result<(), String> {
    require_main(&window)?;
    crate::blocking(move || {
        runtime()
            .lock()
            .map_err(|e| e.to_string())?
            .sync(terminals, dirty_paths)
            .map(|_| ())
    })
    .await?
}

#[tauri::command]
pub async fn plugin_file_permission_reply(
    window: WebviewWindow,
    request_id: String,
    decision: Decision,
) -> Result<(), String> {
    require_main(&window)?;
    crate::blocking(move || {
        runtime()
            .lock()
            .map_err(|e| e.to_string())?
            .permissions
            .reply(&request_id, decision)
    })
    .await?
}

/// The main window shows a first-use question (the agent keeps waiting for the answer).
#[tauri::command]
pub async fn plugin_file_request_seen(
    window: WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    runtime()
        .lock()
        .map_err(|e| e.to_string())?
        .consent
        .mark_seen(&request_id);
    Ok(())
}

/// Answers the first-use question an agent's file tool call raised.
#[tauri::command]
pub async fn plugin_file_consent_reply(
    app: AppHandle,
    window: WebviewWindow,
    request_id: String,
    decision: ConsentDecision,
) -> Result<PluginsState, String> {
    require_main(&window)?;
    crate::blocking(move || {
        let dir = super::plugins_dir(&app)?;
        let answered = runtime()
            .lock()
            .map_err(|e| e.to_string())?
            .consent
            .reply(&request_id, decision)?;
        if decision == ConsentDecision::Always {
            match answered.subject.strip_prefix("app:") {
                Some(application) => {
                    let grant = super::file_consent::grant(application, &answered.project);
                    if let Err(error) = super::catalog::set_app_grant(&dir, &grant, true) {
                        // Not saved: the grant must not outlive this answer either.
                        if let Ok(mut runtime) = runtime().lock() {
                            runtime.consent.always_apps.remove(&grant);
                        }
                        return Err(error);
                    }
                }
                None => {
                    super::catalog::set_files_access(&dir, "always")?;
                    runtime()
                        .lock()
                        .map_err(|e| e.to_string())?
                        .consent
                        .grant_all();
                }
            }
        }
        if decision == ConsentDecision::Always {
            // An application grant covers only its project's open questions.
            let project = answered
                .subject
                .starts_with("app:")
                .then_some(answered.project);
            let _ = crate::emit_safe::emit_to_main(
                &app,
                "plugin-file-consent-granted",
                serde_json::json!({ "subject": answered.subject, "projectId": project }),
            );
        }
        Ok(super::state(&dir, None))
    })
    .await?
}

/// Takes back "Always allow" for one application in one project: its next use there asks again.
#[tauri::command]
pub async fn plugins_forget_app(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    project_id: String,
) -> Result<PluginsState, String> {
    require_main(&window)?;
    crate::blocking(move || {
        let dir = super::plugins_dir(&app)?;
        let grant = super::file_consent::grant(&id, &project_id);
        super::catalog::set_app_grant(&dir, &grant, false)?;
        runtime()
            .lock()
            .map_err(|e| e.to_string())?
            .consent
            .always_apps
            .remove(&grant);
        Ok(super::state(&dir, None))
    })
    .await?
}

/// "ask" (the first use from each terminal asks), "always" or "off".
#[tauri::command]
pub async fn plugins_set_files_access(
    app: AppHandle,
    window: WebviewWindow,
    access: String,
) -> Result<PluginsState, String> {
    require_main(&window)?;
    if !matches!(access.as_str(), "ask" | "always" | "off") {
        return Err("Unknown file access mode.".into());
    }
    crate::blocking(move || {
        let dir = super::plugins_dir(&app)?;
        let offered = access != "off";
        if offered {
            if !cfg!(windows) {
                return Err("File tools are currently available on Windows only.".into());
            }
            if !super::catalog::agents_connected(&dir) {
                return Err("Connect agents before enabling file access.".into());
            }
            super::bridge::serve(&app, &dir)?;
        }
        super::catalog::set_files_access(&dir, &access)?;
        {
            let mut runtime = runtime().lock().map_err(|e| e.to_string())?;
            runtime.set_enabled(offered);
            if access == "always" {
                runtime.consent.grant_all();
            } else {
                runtime.consent.always = false;
                // Session grants end with a stricter choice; open questions stay open.
                runtime.consent.clear_sessions();
            }
        }
        if access == "always" {
            let _ = crate::emit_safe::emit_to_main(
                &app,
                "plugin-file-consent-granted",
                super::file_consent::FILES,
            );
        }
        if let Err(error) =
            crate::emit_safe::emit_to_main(&app, "plugin-file-access-changed", offered)
        {
            eprintln!("[plugins] Could not announce file access change: {error}");
        }
        // Existing configured bridges refresh their catalog; this never edits client configs.
        Ok(super::state(&dir, None))
    })
    .await?
}

#[cfg(test)]
mod tests {
    #[test]
    fn file_control_plane_is_main_window_only() {
        assert!(super::require_label("main").is_ok());
        for label in ["", "detached-1", "plugin", "preview-1"] {
            assert!(super::require_label(label).is_err());
        }
    }
}
