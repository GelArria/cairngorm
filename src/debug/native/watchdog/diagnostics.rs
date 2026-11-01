use super::{minidump::write_minidump, SNAPSHOTS};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub(super) fn save_diagnostics(app: &tauri::AppHandle, hang_secs: u64) -> (String, Option<String>) {
    match try_save_diagnostics(app, hang_secs) {
        Ok(paths) => paths,
        Err(error) => {
            eprintln!("[diagnostics] Could not save private diagnostic files: {error}");
            ("Diagnostics could not be saved.".into(), None)
        }
    }
}

fn try_save_diagnostics(
    app: &tauri::AppHandle,
    hang_secs: u64,
) -> Result<(String, Option<String>), Box<dyn std::error::Error>> {
    let dir = private_log_dir(&app.path().config_dir()?)?;
    crate::data_policy::prune_diagnostics(&dir);
    let ts = format_timestamp();
    let id = uuid::Uuid::new_v4();

    let json_path = dir.join(format!("hang-{ts}-{id}.json"));
    let mut payload = serde_json::json!({ "hangDurationSecs": hang_secs, "hangTimestamp": ts });
    if let Ok(guard) = SNAPSHOTS.lock() {
        payload["snapshots"] =
            serde_json::to_value(guard.iter().collect::<Vec<_>>()).unwrap_or_default();
    }
    write_private_json(&json_path, &serde_json::to_vec_pretty(&payload)?)?;

    let dmp_path_str = dir
        .join(format!("hang-{ts}-{id}.dmp"))
        .to_string_lossy()
        .to_string();
    let dmp_ok = crate::data_policy::memory_dumps_enabled() && write_minidump(&dmp_path_str);

    Ok((
        json_path.to_string_lossy().to_string(),
        if dmp_ok { Some(dmp_path_str) } else { None },
    ))
}

fn private_log_dir(config_dir: &Path) -> io::Result<PathBuf> {
    if !config_dir.is_absolute() {
        return Err(io::Error::other(
            "An absolute user configuration directory is required",
        ));
    }
    fs::create_dir_all(config_dir)?;
    let app_dir = config_dir.join("Cairngorm");
    let dir = app_dir.join("logs");
    for path in [&app_dir, &dir] {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        let meta = fs::symlink_metadata(path)?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(io::Error::other("Diagnostic directories must not be links"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(dir)
}

fn write_private_json(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

fn format_timestamp() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let s = dur.as_secs();
    let t = s % 86400;
    // YYYY-MM-DD from epoch
    let mut days = s / 86400;
    let mut y = 1970;
    loop {
        let dy = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
            366
        } else {
            365
        };
        if days < dy {
            break;
        }
        days -= dy;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let md = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut mo = 1u64;
    let mut day = 1u64;
    for (i, &d) in md.iter().enumerate() {
        if days < d {
            mo = i as u64 + 1;
            day = days + 1;
            break;
        }
        days -= d;
    }
    format!(
        "{:04}-{:02}-{:02}-{:02}{:02}{:02}",
        y,
        mo,
        day,
        t / 3600,
        (t % 3600) / 60,
        t % 60
    )
}

#[cfg(test)]
#[path = "../../../../tests/native/diagnostics.rs"]
mod tests;
