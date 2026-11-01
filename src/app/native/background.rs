//! Background mode: closing the window while terminals still work hides Cairngorm instead of
//! ending it, like detaching a multiplexer client while its server keeps the panes alive.
//! PTYs already live in this process, so the windows only come back and reattach.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Default)]
struct State {
    active: bool,
    /// Windows put away on entering the background, shown again on return.
    hidden: Vec<String>,
}

static STATE: Mutex<State> = Mutex::new(State {
    active: false,
    hidden: Vec::new(),
});
/// A tray quit waits for main to start its close; a frozen page cannot.
static QUIT_PENDING: AtomicBool = AtomicBool::new(false);
const QUIT_EVENT: &str = "app-quit-requested";
const QUIT_GRACE: Duration = Duration::from_secs(5);

/// Puts every window away and leaves a way back (tray icon, or the taskbar on Linux).
#[tauri::command]
pub fn app_background_enter(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can move Cairngorm to the background".into());
    }
    put_all_away(&app).inspect_err(|_| reveal(&app))
}

/// Main has received the quit and runs its own close now.
#[tauri::command]
pub fn app_background_quit_started() {
    QUIT_PENDING.store(false, Ordering::SeqCst);
}

fn put_all_away(app: &AppHandle) -> Result<(), String> {
    tray::show(app)?;
    STATE.lock().unwrap().active = true;
    crate::watchdog::set_paused(true);
    // Main first: a window being hidden can hand focus to main, which would count as a return.
    let mut windows: Vec<_> = app.webview_windows().into_iter().collect();
    windows.sort_by_key(|(label, _)| label != "main");
    for (label, window) in windows {
        if !on_screen(&window) {
            continue;
        }
        // No lock while windows move: their focus events re-enter this module.
        put_away(&window).map_err(|e| e.to_string())?;
        let mut state = STATE.lock().unwrap();
        if !state.hidden.contains(&label) {
            state.hidden.push(label);
        }
    }
    Ok(())
}

/// Linux has no tray here, so its windows stay reachable as minimized taskbar entries.
fn on_screen(window: &WebviewWindow) -> bool {
    let visible = window.is_visible().unwrap_or(false);
    if cfg!(target_os = "linux") {
        visible && !window.is_minimized().unwrap_or(false)
    } else {
        visible
    }
}

fn put_away(window: &WebviewWindow) -> tauri::Result<()> {
    if cfg!(target_os = "linux") {
        window.minimize()
    } else {
        window.hide()
    }
}

/// Main came back however it was reached: restore the other windows and drop the tray.
pub fn returned(app: &AppHandle) {
    let hidden = {
        let mut state = STATE.lock().unwrap();
        if !state.active {
            return;
        }
        state.active = false;
        std::mem::take(&mut state.hidden)
    };
    for label in hidden {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
            let _ = window.unminimize();
        }
    }
    tray::hide(app);
    crate::watchdog::set_paused(false);
}

/// Shows and focuses main. Also answers a second launch of the app.
pub fn reveal(app: &AppHandle) {
    returned(app);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

/// Quit from the background: main runs its normal close (save, record agent sessions to
/// resume, stop terminals) and stays visible so any confirmation it asks for is seen.
pub fn quit(app: &AppHandle) {
    reveal(app);
    QUIT_PENDING.store(true, Ordering::SeqCst);
    let delivered =
        app.get_webview_window("main").is_some() && app.emit_to("main", QUIT_EVENT, ()).is_ok();
    let app = app.clone();
    std::thread::spawn(move || {
        if delivered {
            std::thread::sleep(QUIT_GRACE);
        }
        if QUIT_PENDING.swap(false, Ordering::SeqCst) {
            eprintln!("[background] main did not answer the quit; stopping terminals directly");
            let _ = tauri::async_runtime::block_on(crate::pty::pty_snapshot_sessions(app.clone()));
            crate::pty::pty_cleanup_all();
            crate::plugins::release_app_windows();
            app.exit(0);
        }
    });
}

#[cfg(not(target_os = "linux"))]
mod tray {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::AppHandle;

    const ID: &str = "background";

    pub fn show(app: &AppHandle) -> Result<(), String> {
        if app.tray_by_id(ID).is_some() {
            return Ok(());
        }
        let error = |e: tauri::Error| e.to_string();
        let open = MenuItem::with_id(app, "background-open", "Open Cairngorm", true, None::<&str>)
            .map_err(error)?;
        let quit = MenuItem::with_id(app, "background-quit", "Quit Cairngorm", true, None::<&str>)
            .map_err(error)?;
        let separator = PredefinedMenuItem::separator(app).map_err(error)?;
        let menu = Menu::with_items(app, &[&open, &separator, &quit]).map_err(error)?;
        let mut tray = TrayIconBuilder::with_id(ID)
            .tooltip("Cairngorm: terminals running in the background")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "background-open" => super::reveal(app),
                "background-quit" => super::quit(app),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    super::reveal(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app).map(|_| ()).map_err(error)
    }

    pub fn hide(app: &AppHandle) {
        app.remove_tray_by_id(ID);
    }
}

#[cfg(target_os = "linux")]
mod tray {
    pub fn show(_app: &tauri::AppHandle) -> Result<(), String> {
        Ok(())
    }

    pub fn hide(_app: &tauri::AppHandle) {}
}
