use super::{
    store::Scheduler,
    task::{now, Task, TaskInput},
};
use tauri::State;

#[tauri::command(async)]
pub fn scheduled_tasks_list(state: State<'_, Scheduler>) -> Result<Vec<Task>, String> {
    super::ensure_supported()?;
    let guard = state.0.lock().map_err(|_| "Scheduled tasks are busy")?;
    Ok(guard.as_ref().map_err(Clone::clone)?.tasks.clone())
}

#[tauri::command(async)]
pub fn scheduled_tasks_save(
    state: State<'_, Scheduler>,
    mut input: TaskInput,
) -> Result<(), String> {
    super::ensure_supported()?;
    input.validate()?;
    let mut guard = state.0.lock().map_err(|_| "Scheduled tasks are busy")?;
    let store = guard.as_mut().map_err(|e| e.clone())?;
    let mut tasks = store.tasks.clone();
    if let Some(id) = input.id.as_ref() {
        let task = tasks
            .iter_mut()
            .find(|task| task.input.id.as_ref() == Some(id))
            .ok_or("Scheduled task no longer exists")?;
        if task.status == "running" {
            return Err("Wait for the current run to finish before editing.".into());
        }
        task.input = input;
        task.enabled = true;
        task.requested = false;
        task.status = "scheduled".into();
    } else {
        if tasks.len() >= 100 {
            return Err("Keep at most 100 scheduled tasks. Delete an unused task first.".into());
        }
        input.id = Some(uuid::Uuid::new_v4().to_string());
        tasks.push(Task {
            input,
            enabled: true,
            requested: false,
            status: "scheduled".into(),
            last_run: None,
            output: String::new(),
            changes: None,
        });
    }
    store.commit(tasks)
}

#[tauri::command(async)]
pub fn scheduled_tasks_action(
    state: State<'_, Scheduler>,
    id: String,
    action: String,
) -> Result<(), String> {
    super::ensure_supported()?;
    let mut guard = state.0.lock().map_err(|_| "Scheduled tasks are busy")?;
    let store = guard.as_mut().map_err(|e| e.clone())?;
    let mut tasks = store.tasks.clone();
    let index = tasks
        .iter()
        .position(|task| task.input.id.as_deref() == Some(&id))
        .ok_or("Scheduled task no longer exists")?;
    let task = &mut tasks[index];
    if task.status == "running" && action != "pause" {
        return Err("Wait for the current run to finish before changing this task.".into());
    }
    match action.as_str() {
        "pause" => {
            task.enabled = false;
            task.requested = false;
        }
        "resume" => {
            if task.input.interval_minutes.is_none() && task.input.next_at <= now() {
                return Err("Choose a future time by editing this one-time task.".into());
            }
            task.enabled = true;
        }
        "run" => {
            task.requested = true;
        }
        "delete" => {
            tasks.remove(index);
        }
        _ => return Err("Unsupported scheduled task action".into()),
    }
    store.commit(tasks)
}

#[tauri::command(async)]
pub fn scheduled_tasks_delete_project(
    state: State<'_, Scheduler>,
    project_id: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Scheduled tasks are busy")?;
    let store = guard.as_mut().map_err(|e| e.clone())?;
    if store
        .tasks
        .iter()
        .any(|task| task.input.project_id == project_id && task.status == "running")
    {
        return Err("Wait for this project's scheduled run to finish before deleting it.".into());
    }
    let tasks = store
        .tasks
        .iter()
        .filter(|task| task.input.project_id != project_id)
        .cloned()
        .collect();
    store.commit(tasks)
}
