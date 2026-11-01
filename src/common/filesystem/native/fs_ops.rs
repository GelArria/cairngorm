// File-tree operations behind the right-click menus: create / rename / delete /
// copy / reveal / open. Plain std::fs on purpose — the fs plugin is scoped to app
// dirs, and these act on arbitrary project folders the user opened. Disk I/O
// and OS launches run on the blocking pool, never the shared async workers.
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

fn no_window(c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = c;
}

/// Only absolute paths without `..` — never resolve against the process cwd.
fn checked(p: &str) -> Result<&Path, String> {
    let path = Path::new(p);
    if !path.is_absolute() || path.components().any(|c| c == Component::ParentDir) {
        return Err("Path must be absolute and contain no \"..\"".into());
    }
    Ok(path)
}

/// The tree changed on disk → the search index re-walks in the background.
fn changed<T>(r: Result<T, String>) -> Result<T, String> {
    if r.is_ok() {
        crate::search_walk::refresh_in_background();
    }
    r
}

fn must_not_exist(p: &Path) -> Result<(), String> {
    if p.exists() {
        Err(format!(
            "\"{}\" already exists",
            p.file_name().and_then(|n| n.to_str()).unwrap_or("item")
        ))
    } else {
        Ok(())
    }
}

/// Recursive copy. Symlinks / junctions are never followed (a link to an
/// ancestor would recurse forever) — they are skipped. Refuses to copy a folder
/// into itself.
fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(from).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        if to.starts_with(from) {
            return Err("Cannot copy a folder into itself".into());
        }
        fs::create_dir_all(to).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn fs_create_file(path: String) -> Result<(), String> {
    crate::blocking(move || {
        let p = checked(&path)?;
        // create_new = atomic "fail if it exists" (never truncates a file that appeared meanwhile)
        changed(
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(p)
                .map(|_| ())
                .map_err(|e| {
                    if e.kind() == std::io::ErrorKind::AlreadyExists {
                        format!(
                            "\"{}\" already exists",
                            p.file_name().and_then(|n| n.to_str()).unwrap_or("item")
                        )
                    } else {
                        e.to_string()
                    }
                }),
        )
    })
    .await?
}

#[tauri::command]
pub async fn fs_create_dir(path: String) -> Result<(), String> {
    crate::blocking(move || {
        let p = checked(&path)?;
        must_not_exist(p)?;
        fs::create_dir_all(p).map_err(|e| e.to_string())
    })
    .await?
}

/// Rename or move (cut + paste). Never overwrites — except a case-only rename
/// (`a.txt` → `A.txt`) on a case-insensitive filesystem, which is the same file.
#[tauri::command]
pub async fn fs_rename(from: String, to: String) -> Result<(), String> {
    crate::blocking(move || {
        let (f, t) = (checked(&from)?, checked(&to)?);
        if f == t {
            return Ok(());
        }
        if t.exists() {
            let same_file =
                matches!((fs::canonicalize(f), fs::canonicalize(t)), (Ok(a), Ok(b)) if a == b);
            if !same_file {
                return must_not_exist(t);
            }
        } else if t.starts_with(f) {
            return Err("Cannot move a folder into itself".into());
        }
        changed(fs::rename(f, t).map_err(|e| e.to_string()))
    })
    .await?
}

/// Copy (duplicate / copy + paste). Never overwrites.
#[tauri::command]
pub async fn fs_copy(from: String, to: String) -> Result<(), String> {
    crate::blocking(move || {
        let (f, t) = (checked(&from)?, checked(&to)?);
        must_not_exist(t)?;
        changed(copy_recursive(f, t))
    })
    .await?
}

/// Permanent delete — the UI confirms first. A symlink is removed, never followed.
#[tauri::command]
pub async fn fs_delete(path: String) -> Result<(), String> {
    crate::blocking(move || {
        let p = PathBuf::from(checked(&path)?);
        if p.parent().is_none() {
            return Err("Refusing to delete a drive root".into());
        }
        let meta = fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
        changed(
            if meta.is_dir() && !meta.file_type().is_symlink() {
                fs::remove_dir_all(&p)
            } else {
                fs::remove_file(&p).or_else(|_| fs::remove_dir(&p))
            }
            .map_err(|e| e.to_string()),
        )
    })
    .await?
}

/// Show the item selected in the OS file manager.
#[tauri::command]
pub async fn fs_reveal(path: String) -> Result<(), String> {
    crate::blocking(move || {
        let p = checked(&path)?;
        if !p.exists() {
            return Err("Path no longer exists".into());
        }
        let mut c;
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c = Command::new("explorer");
            // raw_arg: explorer wants `/select,"C:\a b\c"` verbatim, not Rust's whole-arg quoting
            c.raw_arg(format!("/select,\"{}\"", path.replace('/', "\\")));
        }
        #[cfg(target_os = "macos")]
        {
            c = Command::new("open");
            c.arg("-R").arg(&path);
        }
        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            c = Command::new("xdg-open");
            c.arg(p.parent().unwrap_or(p));
        }
        no_window(&mut c);
        c.spawn().map(|_| ()).map_err(|e| e.to_string())
    })
    .await?
}

/// Extensions that would RUN instead of open — refused (use a terminal on purpose).
const LAUNCHABLE: &[&str] = &[
    "exe", "com", "bat", "cmd", "scr", "msi", "lnk", "ps1", "vbs", "vbe", "js", "jse", "wsf",
    "hta", "jar", "reg", "sh", "appimage", "app", "command",
];

fn is_launchable(p: &Path) -> bool {
    p.is_file()
        && p.extension()
            .and_then(|e| e.to_str())
            .map(|e| LAUNCHABLE.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
}

/// Open with the OS default application (documents, images, folders).
#[tauri::command]
pub async fn fs_open_default(path: String) -> Result<(), String> {
    crate::blocking(move || {
        let p = checked(&path)?;
        if !p.exists() {
            return Err("Path no longer exists".into());
        }
        if is_launchable(p) {
            return Err("Won't launch an executable or script from the file tree".into());
        }
        let mut c;
        #[cfg(windows)]
        {
            // explorer opens a file with its default app (no shell parsing of the path)
            c = Command::new("explorer");
            c.arg(path.replace('/', "\\"));
        }
        #[cfg(target_os = "macos")]
        {
            c = Command::new("open");
            c.arg(&path);
        }
        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            c = Command::new("xdg-open");
            c.arg(&path);
        }
        no_window(&mut c);
        c.spawn().map(|_| ()).map_err(|e| e.to_string())
    })
    .await?
}

#[cfg(test)]
#[path = "../../../../tests/native/fs-ops.rs"]
mod tests;
