//! MCP App plugins: handpicked tools whose views open next to the agent that uses them.
#[path = "./plugin_activity.rs"]
mod activity;
#[path = "./plugin_agent_targets.rs"]
mod agent_targets;
#[path = "./plugin_agents.rs"]
mod agents;
#[path = "./plugin_app_busy.rs"]
mod app_busy;
#[path = "./plugin_app_cancel.rs"]
mod app_cancel;
#[path = "./plugin_app_discovery.rs"]
mod app_discovery;
#[path = "./plugin_app_mcp.rs"]
mod app_mcp;
#[path = "./plugin_app_mcp_io.rs"]
mod app_mcp_io;
#[path = "./plugin_app_mcp_session.rs"]
mod app_mcp_session;
#[path = "./plugin_app_mcp_sessions.rs"]
mod app_mcp_sessions;
#[path = "./plugin_app_mcp_tools.rs"]
mod app_mcp_tools;
#[path = "./plugin_app_osa.rs"]
mod app_osa;
#[path = "./plugin_app_run.rs"]
mod app_run;
#[path = "./plugin_app_script.rs"]
mod app_script;
#[path = "./plugin_app_settings.rs"]
mod app_settings;
#[path = "./plugin_app_watch.rs"]
mod app_watch;
#[path = "./plugin_app_window.rs"]
mod app_window;
#[path = "./plugin_app_window_commands.rs"]
mod app_window_commands;
#[path = "./plugin_applications.rs"]
mod applications;
#[path = "./plugin_apps.rs"]
mod apps;
#[path = "./plugin_client_commands.rs"]
mod client_commands;
#[path = "./plugin_clients.rs"]
mod clients;
pub use client_commands::*;
#[path = "./plugin_bridge.rs"]
mod bridge;
#[path = "./plugin_callback.rs"]
mod callback;
#[path = "./plugin_callers.rs"]
mod callers;
// Shared process identity for terminal session capture; never inferred from model names.
pub(crate) use callers::agent_of_process;
#[path = "./plugin_calls.rs"]
mod calls;
#[path = "./plugin_canvas.rs"]
mod canvas;
#[path = "./plugin_catalog.rs"]
mod catalog;
#[path = "./plugin_config_edit.rs"]
mod config_edit;
#[path = "./plugin_context.rs"]
mod context;
#[path = "./plugin_disconnect.rs"]
mod disconnect;
#[path = "./plugin_file_clients.rs"]
mod file_clients;
#[path = "./plugin_file_commands.rs"]
mod file_commands;
#[path = "./plugin_file_consent.rs"]
mod file_consent;
#[path = "./plugin_file_create.rs"]
mod file_create;
#[path = "./plugin_file_dispatch.rs"]
mod file_dispatch;
pub use app_window_commands::*;
pub use file_commands::*;
#[path = "./plugin_file_handles.rs"]
mod file_handles;
#[path = "./plugin_file_permissions.rs"]
mod file_permissions;
#[path = "./plugin_file_runtime.rs"]
mod file_runtime;
#[path = "./plugin_file_scope.rs"]
mod file_scope;
#[path = "./plugin_files.rs"]
mod files;
#[path = "./plugin_gateway.rs"]
mod gateway;
#[path = "./plugin_http.rs"]
mod http;
#[path = "./plugin_mcp.rs"]
mod mcp;
#[path = "./plugin_mcp_edit.rs"]
mod mcp_edit;
#[path = "./plugin_mcp_redact.rs"]
mod mcp_redact;
#[path = "./plugin_mcp_servers.rs"]
mod mcp_servers;
#[path = "./plugin_oauth.rs"]
mod oauth;
#[path = "./plugin_oauth_client.rs"]
mod oauth_client;
#[path = "./plugin_oauth_token.rs"]
mod oauth_token;
#[path = "./plugin_state.rs"]
mod plugin_state;
#[path = "./plugin_scope.rs"]
mod scope;
#[path = "./plugin_sign_in.rs"]
mod sign_in;
#[path = "./plugin_terminal.rs"]
mod terminal;
#[path = "./plugin_tokens.rs"]
mod tokens;
#[path = "./plugin_upstream.rs"]
mod upstream;
#[path = "./plugin_vault.rs"]
mod vault;
#[path = "./plugin_view_requests.rs"]
mod view_requests;

use bridge::{activate, bridge_path, env, home, serve};
use catalog::Auth;
// Glob: Tauri commands need their generated companion items re-exported too.
pub use mcp_servers::*;
pub use plugin_state::PluginsState;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(super) fn plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins"))
}

/// Takes the bridge out of every agent and MCP client config. `dir` is the plugins folder
/// (from the app, or derived by the uninstaller, which has no running app).
pub fn disconnect_agents(dir: &std::path::Path) -> Vec<Result<(), String>> {
    let results = disconnect::disconnect_all(dir, &home(), &env);
    if let Ok(mut runtime) = file_runtime::runtime().lock() {
        runtime.set_enabled(false);
    }
    results
}

pub fn app_plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    plugins_dir(app)
}

/// Before the main window closes: application windows shown in panes get their own frame
/// back (Windows destroys windows owned by a closing window). Application MCP servers end.
pub fn release_app_windows() {
    #[cfg(windows)]
    app_window::release_all();
    app_mcp_sessions::end_all();
}

/// Close admission and restore windows under the same lock as docking.
pub fn prepare_app_window_close() -> Result<(), String> {
    #[cfg(windows)]
    return app_window::prepare_close();
    #[cfg(not(windows))]
    Ok(())
}

/// The loopback gateway's origin, starting it when needed (document panes use it too).
pub fn gateway_origin(app: &AppHandle) -> Result<String, String> {
    let dir = plugins_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(gateway::ensure(app, dir)?.origin.clone())
}

/// Startup: agents launched before the window opens must find a running gateway.
pub fn init(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let Ok(dir) = plugins_dir(&app) else {
            return;
        };
        let files = catalog::files_offered(&dir) && catalog::agents_connected(&dir);
        if let Ok(mut runtime) = file_runtime::runtime().lock() {
            runtime.set_enabled(files && cfg!(windows));
            runtime.consent.always = catalog::files_enabled(&dir);
            runtime.consent.always_apps = catalog::app_grants(&dir).into_iter().collect();
        }
        if catalog::enabled(&dir).is_empty() && !files {
            return;
        }
        if let Err(error) = serve(&app, &dir) {
            eprintln!("[plugins] {error}");
        }
    });
}

pub(super) fn state(dir: &std::path::Path, error: Option<String>) -> PluginsState {
    plugin_state::state(dir, &home(), &env, &bridge_path(dir), error)
}

/// Another account may bring other tools; a running gateway must not reuse the old ones.
fn reset_upstream(id: &str) {
    if let Some(gateway) = gateway::running() {
        gateway.reset_upstream(id);
    }
}

/// Sign-in pages open in the user's own browser, where their accounts and passkeys are.
fn open_in_browser(app: &AppHandle, url: &str) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    #[allow(deprecated)]
    app.shell()
        .open(url, None)
        .map_err(|e| format!("Could not open the browser: {e}"))
}

#[tauri::command]
pub async fn plugins_state(app: AppHandle) -> Result<PluginsState, String> {
    crate::blocking(move || Ok(state(&plugins_dir(&app)?, None))).await?
}

/// One explicit approval connects every installed, supported CLI to the shared bridge.
#[tauri::command]
pub async fn plugins_connect_agents(app: AppHandle) -> Result<PluginsState, String> {
    crate::blocking(move || {
        let dir = plugins_dir(&app)?;
        // Check prerequisites before persisting approval or editing agent configurations.
        agents::runtime().ok_or("Plugins need Node.js or Bun to connect agents")?;
        serve(&app, &dir)?;
        catalog::connect_agents(&dir)?;
        // File tools are offered from now on (asking first, unless turned off).
        if catalog::files_offered(&dir) && cfg!(windows) {
            if let Ok(mut runtime) = file_runtime::runtime().lock() {
                runtime.set_enabled(true);
            }
        }
        Ok(state(&dir, activate(&app, &dir).err()))
    })
    .await?
}

/// Adding an OAuth plugin signs in first (or again, when its sign-in is gone); removing
/// one signs out, so nothing of that account stays on this machine.
#[tauri::command]
pub async fn plugins_set_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<PluginsState, String> {
    crate::blocking(move || {
        let dir = plugins_dir(&app)?;
        let plugin = catalog::find(&id).ok_or("Unknown plugin")?;
        if enabled && plugin.local_app {
            let availability = applications::availability(plugin.id);
            if !availability.installed {
                return Err(format!(
                    "{} is not installed. Install it separately, then refresh the catalog.",
                    plugin.name
                ));
            }
            if !availability.connected {
                return Err(availability.message);
            }
        }
        if enabled && !catalog::agents_connected(&dir) {
            return Err("Connect plugins to your agents first".into());
        }
        if plugin.auth == Auth::OAuth {
            if enabled && !tokens::signed_in(plugin.id) {
                if let Err(error) = sign_in::sign_in(plugin, |url| open_in_browser(&app, url)) {
                    // Cancelling is the user's own choice, not something to report.
                    let error = (error != sign_in::CANCELLED).then_some(error);
                    return Ok(state(&dir, error));
                }
            }
            if !enabled {
                tokens::forget(plugin.id);
            }
            reset_upstream(plugin.id);
        }
        catalog::set_enabled(&dir, &id, enabled)?;
        let error = if enabled {
            activate(&app, &dir).err()
        } else {
            None
        };
        Ok(state(&dir, error))
    })
    .await?
}

/// Stops waiting for a browser sign-in; the pending `plugins_set_enabled` then returns.
#[tauri::command]
pub fn plugins_cancel_sign_in() {
    sign_in::cancel();
}

/// MCP requests a view sends to its own server, after the host's visibility checks.
#[tauri::command]
pub async fn plugin_view_request(
    call_id: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    crate::blocking(move || {
        let call = calls::get(&call_id).ok_or("This view has expired")?;
        let upstream = gateway::running()
            .and_then(|g| g.upstream(call.plugin, call.terminal.as_deref()))
            .ok_or("Plugins are not running")?;
        view_requests::request(&call, &upstream, &method, params)
    })
    .await?
}

#[tauri::command(async)]
pub fn plugin_view_event(call_id: String, event: String, payload: Value) -> Result<Value, String> {
    let call = calls::get(&call_id).ok_or("This view has expired")?;
    calls::view_event(&call, &event, payload)?;
    let canvas_id = call.canvas.lock().map_err(|e| e.to_string())?.clone();
    Ok(
        json!({"canvasId":canvas_id,"emptyCanvasWithoutCheckpoint":event == "context" && canvas::empty_without_checkpoint(&call)}),
    )
}

#[tauri::command]
pub async fn plugin_prepare_reload(call_id: String) -> Result<(), String> {
    crate::blocking(move || {
        let call = calls::get(&call_id).ok_or("This view has expired")?;
        let upstream = gateway::running()
            .and_then(|g| g.upstream(call.plugin, call.terminal.as_deref()))
            .ok_or("Plugins are not running")?;
        view_requests::prepare_reload(&call, &upstream)
    })
    .await?
}

/// Views load from the gateway origin. The real protection is Tauri's invoke key, which
/// only the main frame receives; this is defense in depth where the webview reports the
/// subframe's origin on IPC requests (WebView2 does; WebKit may not).
pub fn from_view_origin(headers: &tauri::http::HeaderMap) -> bool {
    let Some(gateway) = gateway::running() else {
        return false;
    };
    headers
        .get("origin")
        .and_then(|origin| origin.to_str().ok())
        .is_some_and(|origin| {
            scope::is_view_origin(&gateway.origin, origin)
                || crate::documents::is_document_origin(&gateway.origin, origin)
        })
}

/// Source terminals own calls, including views in inactive projects.
pub fn release_terminal(terminal: &str) {
    calls::release_terminal(terminal);
    canvas::release_terminal(terminal);
    app_mcp_sessions::end_terminal(terminal);
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_lifecycle.rs"]
mod lifecycle_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_reload.rs"]
mod reload_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugins.rs"]
mod tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_agents.rs"]
mod agent_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_connections.rs"]
mod connection_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_custom_clients.rs"]
mod custom_client_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_client_activity.rs"]
mod client_activity_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_pi_discovery.rs"]
mod pi_discovery_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_contract.rs"]
mod contract_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_isolation.rs"]
mod isolation_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_oauth.rs"]
mod oauth_tests;

#[cfg(test)]
#[path = "../../../tests/native/plugin_oauth_units.rs"]
mod oauth_unit_tests;
