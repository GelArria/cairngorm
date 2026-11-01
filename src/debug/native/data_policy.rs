#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPolicy {
    persist_scrollback: bool,
    retention_days: u32,
}

#[tauri::command]
pub fn get_data_policy() -> DataPolicy {
    DataPolicy {
        persist_scrollback: std::env::var("CAIRNGORM_PERSIST_SCROLLBACK").as_deref() != Ok("0"),
        retention_days: std::env::var("CAIRNGORM_RETENTION_DAYS")
            .ok()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(7)
            .clamp(1, 365),
    }
}

pub fn memory_dumps_enabled() -> bool {
    std::env::var("CAIRNGORM_ENABLE_MEMORY_DUMPS").as_deref() == Ok("1")
}

pub fn prune_diagnostics(dir: &std::path::Path) {
    let lifetime =
        std::time::Duration::from_secs(u64::from(get_data_policy().retention_days) * 86400);
    let Ok(files) = std::fs::read_dir(dir) else {
        return;
    };
    for file in files.flatten() {
        let name = file.file_name().to_string_lossy().into_owned();
        if !(name.starts_with("hang-") || name.starts_with("crash-")) {
            continue;
        }
        let Ok(meta) = file.path().symlink_metadata() else {
            continue;
        };
        if meta.is_file()
            && meta
                .modified()
                .ok()
                .and_then(|v| v.elapsed().ok())
                .is_some_and(|age| age > lifetime)
        {
            let _ = std::fs::remove_file(file.path());
        }
    }
}
