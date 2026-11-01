//! Applications a stopped request may have left busy. A call that never returned keeps the
//! application working on it, and every later request would queue behind it; the next request
//! first checks briefly that the application answers again.
use super::{
    app_discovery::App, app_script, app_watch, file_runtime::Scope, file_scope::FileError,
};
use serde_json::Value;
use std::{collections::HashSet, sync::Mutex, time::Instant};

static SUSPECT: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Records how the application's last request ended.
pub fn finished(app: &str, stopped: bool) {
    let mut guard = SUSPECT.lock().unwrap_or_else(|e| e.into_inner());
    let suspect = guard.get_or_insert_with(HashSet::new);
    if stopped {
        suspect.insert(app.to_string());
    } else {
        suspect.remove(app);
    }
}

/// The last request in this application was stopped before it finished.
pub fn suspect(app: &str) -> bool {
    SUSPECT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|suspect| suspect.contains(app))
}

/// After a stopped request the application must answer a trivial request first. A dialog it
/// shows is reported (and shown) at once: an application waiting on one rejects calls.
pub fn answering(app: &App, scope: &Scope, notify: &dyn Fn(Value)) -> Result<(), FileError> {
    if !suspect(&app.id) {
        return Ok(());
    }
    // Nothing of it runs any more: there is nothing to wait for (and no cold start to time).
    if super::app_window::pids(&app.executable).is_empty() {
        finished(&app.id, false);
        return Ok(());
    }
    let cwd = scope.root.root_path();
    let probe = app_script::run(
        app,
        app_script::probe(),
        cwd,
        app_watch::PROBE,
        Instant::now(),
    )
    .map_err(|e| FileError::new("script-failed", e))?;
    let refused = probe["stopped"].is_null() && probe["exitCode"] != 0;
    if probe["stopped"].is_null() && !refused {
        return Ok(());
    }
    finished(&app.id, true);
    let dialog = match probe["stopped"].as_str() {
        Some("app-dialog") => probe["message"].as_str().map(String::from),
        _ => app_watch::observe(&app.executable)
            .dialog
            .map(|text| app_watch::Stop::Dialog(text).message(&app.name, app_watch::PROBE)),
    };
    if let Some(message) = dialog {
        super::apps::show_window(app, scope, notify, probe["windowHwnd"].as_str());
        return Err(FileError::new("app-dialog", message));
    }
    if probe["stopped"] == "cancelled" {
        return Err(FileError::new("cancelled", "The request was cancelled."));
    }
    Err(FileError::new(
        "app-busy",
        format!(
            "{} is still busy with an earlier request that did not finish, so this one was not \
             started. Ask the user to finish or close it in {}; Cairngorm never closes the user's \
             applications.",
            app.name, app.name
        ),
    ))
}
