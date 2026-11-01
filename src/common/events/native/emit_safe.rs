// Event emission ALWAYS on the main thread — prevents the window deadlock.
//
// Direct `emit()` from a background thread (watchdog, PTY reader, panic hook…)
// can freeze the app: wry sends the eval script to the event loop and waits for
// confirmation with a blocking recv() WHILE holding the lock of
// `HashMap<String, Webview>`. If the main thread is processing an invoke
// (get_webview → same lock), both end up in a cycle: the window stops pumping
// (Responding=False, dead clicks) and the renderer stops delivering heartbeats.
//
// `run_on_main_thread` queues the emit without waiting for anything → no cycle.
//
// Queued closures borrow one AppHandle owned by the main thread instead of carrying a
// clone each: every clone/drop also touches tao's event-loop runner count, so hot paths
// (terminal output) must not do it per event on other threads. See
// src-tauri/patches/tao/CAIRNGORM.md for the heap corruption this guards against.
use serde::Serialize;
use std::any::Any;
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};

thread_local! {
    static MAIN_APP: RefCell<Option<Box<dyn Any>>> = const { RefCell::new(None) };
}
static MAIN_APP_SET: AtomicBool = AtomicBool::new(false);

/// Call once from setup, on the main thread.
pub fn init_main_app<R: Runtime>(app: &AppHandle<R>) {
    MAIN_APP.with(|slot| *slot.borrow_mut() = Some(Box::new(app.clone())));
    MAIN_APP_SET.store(true, Ordering::Release);
}

/// Runs `f` on the main thread with the app handle, without cloning one on this thread.
pub fn on_main_app<R, F>(app: &AppHandle<R>, f: F) -> tauri::Result<()>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) + Send + 'static,
{
    if !MAIN_APP_SET.load(Ordering::Acquire) {
        // Before setup (or in unit tests) there is no main-thread handle yet.
        let handle = app.clone();
        return app.run_on_main_thread(move || f(&handle));
    }
    app.run_on_main_thread(move || {
        MAIN_APP.with(|slot| {
            if let Some(app) = slot.borrow().as_ref().and_then(|a| a.downcast_ref()) {
                f(app);
            } else {
                // Only a second runtime type or a call off the setup thread lands here.
                eprintln!("[events] no main-thread app handle; a queued emit was dropped");
            }
        });
    })
}

pub fn emit_bg<R, E, T>(em: &E, event: &str, payload: T)
where
    R: Runtime,
    E: Manager<R> + Emitter<R>,
    T: Serialize + Clone + Send + 'static,
{
    let event = event.to_string();
    let _ = on_main_app(em.app_handle(), move |app| {
        let _ = app.emit(&event, payload);
    });
}

/// `emit_bg` for the main window only (agent requests, file approvals): queued on the main
/// thread like every background emit, so a gateway worker never blocks on the webview.
pub fn emit_to_main<R, E, T>(em: &E, event: &str, payload: T) -> Result<(), String>
where
    R: Runtime,
    E: Manager<R> + Emitter<R>,
    T: Serialize + Clone + Send + 'static,
{
    // Unit tests have no window (and linking the event loop needs a Common Controls
    // manifest test binaries lack).
    #[cfg(test)]
    {
        let _ = (em, event, payload);
        Ok(())
    }
    #[cfg(not(test))]
    {
        let event = event.to_string();
        on_main_app(em.app_handle(), move |app| {
            if let Err(error) = app.emit_to("main", &event, payload) {
                eprintln!("[events] {event} could not reach the main window: {error}");
            }
        })
        .map_err(|error| error.to_string())
    }
}

/// The built-in event plugin emits on async workers; multi-window invokes can deadlock.
#[tauri::command]
pub async fn emit_terminal_event(
    app: tauri::AppHandle,
    event: String,
    payload: serde_json::Value,
    target: Option<String>,
) -> Result<(), String> {
    if !matches!(
        event.as_str(),
        "terminal-detached-state" | "terminal-reattach"
    ) && !event.starts_with("pty-kill-")
    {
        return Err("unsupported terminal event".into());
    }
    if target.as_deref().is_some_and(|label| label != "main") {
        return Err("unsupported terminal event target".into());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = match target {
            Some(label) if handle.get_webview(&label).is_none() => {
                Err("main window is closed".into())
            }
            Some(label) => handle
                .emit_to(label, &event, payload)
                .map_err(|error| error.to_string()),
            None => handle
                .emit(&event, payload)
                .map_err(|error| error.to_string()),
        };
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "terminal event delivery stopped".to_string())?
}
