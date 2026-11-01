use super::task::Task;
use std::{fs, io::Write, path::PathBuf, sync::Mutex};

pub struct Store {
    pub path: PathBuf,
    pub tasks: Vec<Task>,
    _lease: fs::File,
}
pub struct Scheduler(pub Mutex<Result<Store, String>>);

impl Drop for Store {
    // Unlock explicitly: a forked child that has not exec'd yet still shares the lock
    // file, and closing only our copy would keep the lease taken until it execs.
    fn drop(&mut self) {
        let _ = self._lease.unlock();
    }
}

impl Store {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(path.parent().ok_or("Missing scheduler directory")?)
            .map_err(|e| e.to_string())?;
        let lease = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("lock"))
            .map_err(|e| e.to_string())?;
        lease.try_lock().map_err(|_| "Scheduled tasks are owned by another Cairngorm instance. Close it and reopen this app.".to_string())?;
        if fs::metadata(&path).is_ok_and(|info| info.len() > 33_554_432) {
            return Err("The scheduled task store exceeds its size limit.".into());
        }
        let tasks = match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<Vec<Task>>(&text)
                .map_err(|e| format!("Cannot read scheduled tasks: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(format!("Cannot read scheduled tasks: {e}")),
        };
        if tasks.len() > 100 {
            return Err("Too many saved scheduled tasks.".into());
        }
        let mut ids = std::collections::HashSet::new();
        for task in &tasks {
            task.input.validate_definition()?;
            let id = task
                .input
                .id
                .as_deref()
                .filter(|id| !id.is_empty() && id.len() <= 100)
                .ok_or("Invalid saved scheduled task ID")?;
            if !ids.insert(id)
                || !matches!(
                    task.status.as_str(),
                    "scheduled" | "running" | "succeeded" | "failed" | "interrupted"
                )
                || task.output.len() > 100_000
            {
                return Err("Invalid saved scheduled task state.".into());
            }
        }
        let mut store = Self {
            path,
            tasks,
            _lease: lease,
        };
        if store.tasks.iter().any(|task| task.status == "running") {
            let mut tasks = store.tasks.clone();
            for task in &mut tasks {
                if task.status == "running" {
                    task.status = "interrupted".into();
                    task.enabled = false;
                    task.requested = false;
                    task.output = "Cairngorm stopped during this run. Check the project before running it again.".into();
                }
            }
            store.commit(tasks)?;
        }
        Ok(store)
    }

    pub fn commit(&mut self, tasks: Vec<Task>) -> Result<(), String> {
        fs::create_dir_all(self.path.parent().ok_or("Missing scheduler directory")?)
            .map_err(|e| e.to_string())?;
        let tmp = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&tmp).map_err(|e| e.to_string())?;
            file.write_all(&serde_json::to_vec_pretty(&tasks).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(tmp);
        }
        result?;
        self.tasks = tasks;
        Ok(())
    }
}
