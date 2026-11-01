#[path = "task_commands.rs"]
mod commands;
#[path = "run_changes.rs"]
mod run_changes;
#[path = "runner.rs"]
mod runner;
#[path = "store.rs"]
mod store;
#[path = "task.rs"]
mod task;
pub use commands::*;
use store::{Scheduler, Store};
use tauri::Manager;

pub fn ensure_supported() -> Result<(), String> {
    // shortcut: Unix scheduling waits for verified process-tree ownership across app exit.
    if cfg!(windows) {
        Ok(())
    } else {
        Err("Automatic agent scheduling is currently available on Windows only. Calendar events remain available.".into())
    }
}

pub fn init(app: &tauri::AppHandle) {
    let state = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .and_then(|path| Store::open(path.join("scheduled-tasks.json")));
    if let Err(error) = &state {
        eprintln!("[scheduler] {error}");
    }
    app.manage(Scheduler(std::sync::Mutex::new(state)));
    if ensure_supported().is_err() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let app = app.clone();
            let _ = crate::blocking(move || tick(&app.state::<Scheduler>(), runner::execute)).await;
        }
    });
}

fn tick(state: &Scheduler, execute: impl FnOnce(&task::Task) -> Result<String, String>) {
    let task = {
        let Ok(mut guard) = state.0.lock() else {
            return;
        };
        let Ok(store) = guard.as_mut() else { return };
        let Some((index, _)) = store
            .tasks
            .iter()
            .enumerate()
            .filter(|(_, task)| task.due(task::now()))
            .min_by_key(|(_, task)| (!task.requested, task.input.next_at))
        else {
            return;
        };
        let mut tasks = store.tasks.clone();
        tasks[index].claim(task::now());
        let task = tasks[index].clone();
        // Persist the claim before any side effect; failed writes must not launch an agent.
        if let Err(error) = store.commit(tasks) {
            eprintln!("[scheduler] Cannot claim task: {error}");
            return;
        }
        task
    };
    let root = std::path::Path::new(&task.input.root_path);
    let before = run_changes::snapshot(root);
    let result = execute(&task);
    let changes = before
        .zip(run_changes::snapshot(root))
        .map(|(before, after)| run_changes::changes(&before, &after));
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    let Ok(store) = guard.as_mut() else { return };
    let mut tasks = store.tasks.clone();
    if let Some(saved) = tasks
        .iter_mut()
        .find(|saved| saved.input.id == task.input.id)
    {
        saved.status = if result.is_ok() {
            "succeeded"
        } else {
            "failed"
        }
        .into();
        saved.output = result.unwrap_or_else(|error| error);
        saved.changes = changes;
        if let Err(error) = store.commit(tasks) {
            eprintln!("[scheduler] Cannot save result: {error}");
            // Keep the durable running claim: restarting pauses this uncertain run.
        }
    }
}

#[cfg(test)]
#[path = "../../../tests/native/scheduled-tasks.rs"]
mod tests;
