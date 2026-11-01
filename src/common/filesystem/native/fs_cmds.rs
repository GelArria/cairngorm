// Plain file I/O for the editor and the file tree runs on the blocking pool:
// slow disks and large folders must not occupy the shared async workers.
use base64::Engine;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

/// Held by every write: a save can't land in the middle of a Replace All.
pub static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    name: String,
    path: String,
    is_directory: bool,
    size: Option<u64>,
}

#[tauri::command]
pub async fn fs_list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    crate::blocking(move || list_dir(path)).await?
}

fn list_dir(path: String) -> Result<Vec<FsEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }
    let mut result: Vec<FsEntry> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| {
            let full_path = e.path();
            let meta = e.metadata().or_else(|_| full_path.symlink_metadata()).ok();
            let is_directory = meta
                .as_ref()
                .map(|m| m.is_dir())
                .unwrap_or_else(|| full_path.is_dir());
            FsEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: full_path.to_string_lossy().to_string(),
                is_directory,
                size: meta.as_ref().map(|m| m.len()),
            }
        })
        .collect();
    result.sort_by_cached_key(|e| (!e.is_directory, e.name.to_lowercase()));
    Ok(result)
}

#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<String, String> {
    crate::blocking(move || read_file(path)).await?
}

fn read_file(path: String) -> Result<String, String> {
    if fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false) {
        return Err(format!("Is a directory: {}", path));
    }
    fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
pub async fn fs_read_file_data_url(path: String) -> Result<String, String> {
    crate::blocking(move || read_file_data_url(path)).await?
}

fn read_file_data_url(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    };
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[tauri::command]
pub async fn fs_write_file(path: String, content: String) -> Result<(), String> {
    crate::blocking(move || write_file(path, content)).await?
}

fn write_file(path: String, content: String) -> Result<(), String> {
    let _write = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = Path::new(&path);
    let is_new = !p.exists();
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(p, content).map_err(|e| e.to_string())?;
    if is_new {
        crate::search_walk::refresh_in_background();
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_exists(path: String) -> Result<bool, String> {
    crate::blocking(move || Path::new(&path).exists()).await
}
