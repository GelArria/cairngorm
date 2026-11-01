//! Main-window commands that keep an application's window over its pane.
use super::app_window;
use tauri::WebviewWindow;

#[cfg(windows)]
pub(super) fn checked(hwnd: &str, dock_id: &str) -> Result<Option<app_window::Hwnd>, String> {
    let hwnd: app_window::Hwnd = hwnd.parse().map_err(|_| "Invalid window.")?;
    if app_window::session_closed(hwnd, dock_id) || !app_window::alive(hwnd) {
        return Ok(None);
    }
    if !app_window::is_docked(hwnd) && !app_window::scriptable(hwnd) {
        return Err("This window does not belong to a scriptable application.".into());
    }
    Ok(Some(hwnd))
}

fn valid_bounds(x: f64, y: f64, width: f64, height: f64) -> bool {
    [x, y, width, height]
        .iter()
        .all(|value| value.is_finite() && value.abs() <= 100_000.0)
        && width > 0.0
        && height > 0.0
}

/// Coordinates are CSS pixels inside the main webview. False means the window closed.
/// Async: the Win32 work runs on a worker thread, never on Cairngorm's main (UI) thread,
/// so an application that is slow to respond cannot freeze resizing.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn app_window_dock(
    window: WebviewWindow,
    hwnd: String,
    dock_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
    focus: Option<bool>,
) -> Result<bool, String> {
    super::file_commands::require_main(&window)?;
    if dock_id.is_empty() || dock_id.len() > 128 || !valid_bounds(x, y, width, height) {
        return Err("Invalid application pane bounds or identity.".into());
    }
    #[cfg(windows)]
    {
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let origin = window.inner_position().map_err(|e| e.to_string())?;
        let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let shown = visible && !window.is_minimized().unwrap_or(true);
        let px = move |v: f64| (v * scale).round() as i32;
        crate::blocking(move || {
            let Some(hwnd) = checked(&hwnd, &dock_id)? else {
                return Ok(false);
            };
            let docked = app_window::dock(
                hwnd,
                owner,
                &dock_id,
                origin.x.saturating_add(px(x)),
                origin.y.saturating_add(px(y)),
                px(width),
                px(height),
                shown,
            )?;
            if docked && focus == Some(true) && visible {
                app_window::focus(hwnd);
            }
            Ok(docked)
        })
        .await?
    }
    #[cfg(not(windows))]
    {
        let _ = (hwnd, visible, focus);
        Err("Application windows can be shown in panes on Windows only.".into())
    }
}

/// A late cleanup may release only the docking session that issued it.
#[tauri::command]
pub async fn app_window_release(
    window: WebviewWindow,
    hwnd: String,
    dock_id: String,
) -> Result<(), String> {
    super::file_commands::require_main(&window)?;
    #[cfg(windows)]
    {
        let hwnd: app_window::Hwnd = hwnd.parse().map_err(|_| "Invalid window.")?;
        crate::blocking(move || app_window::release(hwnd, Some(&dock_id))).await??;
    }
    #[cfg(not(windows))]
    let _ = (hwnd, dock_id);
    Ok(())
}

/// Called after close confirmation/storage flush, immediately before native destruction.
#[tauri::command]
pub fn app_window_prepare_close(window: WebviewWindow) -> Result<(), String> {
    super::file_commands::require_main(&window)?;
    super::prepare_app_window_close()
}

/// A canceled close (or a failed storage flush/destroy) allows panes to attach again.
#[tauri::command]
pub fn app_window_cancel_close(window: WebviewWindow) -> Result<(), String> {
    super::file_commands::require_main(&window)?;
    #[cfg(windows)]
    app_window::cancel_close();
    Ok(())
}

/// Explicit user action: launch the registered executable, never an agent script.
#[tauri::command]
pub async fn app_window_open(
    window: WebviewWindow,
    app_id: String,
) -> Result<app_window::AppWindow, String> {
    super::file_commands::require_main(&window)?;
    crate::blocking(move || {
        #[cfg(windows)]
        {
            let app = super::app_discovery::find(&app_id).ok_or("This application is no longer installed.")?;
            if let Some(window) = app_window::main_window(&app.executable) { return Ok(window); }
            std::process::Command::new(&app.executable).spawn().map_err(|e| format!("Could not open {}: {e}", app.name))?;
            for _ in 0..20 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if let Some(window) = app_window::main_window(&app.executable) { return Ok(window); }
            }
            Err(format!("{} has not opened a document window. Close any welcome or sign-in dialog in the application, then try again.", app.name))
        }
        #[cfg(not(windows))]
        { let _ = app_id; Err("Application windows can be shown in panes on Windows only.".into()) }
    }).await?
}

#[cfg(test)]
mod tests {
    #[test]
    fn bounds_refuse_non_finite_empty_and_extreme_values() {
        assert!(super::valid_bounds(-100.0, 20.5, 400.0, 300.0));
        for (x, width) in [
            (f64::NAN, 1.0),
            (f64::INFINITY, 1.0),
            (0.0, 0.0),
            (0.0, -1.0),
            (0.0, 1e12),
        ] {
            assert!(!super::valid_bounds(x, 0.0, width, 1.0));
        }
    }
}

/// The scriptable applications with a window, for the "+" menu (opening one is an explicit
/// user action). An application found only as its MCP server program has no window to show.
#[tauri::command]
pub async fn apps_list(window: WebviewWindow) -> Result<Vec<super::app_discovery::App>, String> {
    super::file_commands::require_main(&window)?;
    crate::blocking(|| {
        super::app_discovery::apps(false)
            .into_iter()
            .filter(|app| {
                app.mcp
                    .as_ref()
                    .map_or(true, |m| m.program != app.executable)
            })
            .collect()
    })
    .await
}
