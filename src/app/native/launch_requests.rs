//! Requests from the `cairngorm` command, at startup or from a second launch. They wait
//! here until the main window takes them, so none is lost while the app starts.
// The app parses; only the command forwards (`to_args`), so that is unused here.
#[allow(dead_code)]
#[path = "../cli/args.rs"]
mod args;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Tells the main window that requests are waiting.
#[cfg_attr(debug_assertions, allow(dead_code))]
const EVENT: &str = "app-launch-request";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    path: Option<String>,
    is_file: bool,
    terminal: bool,
    agent: Option<String>,
    panel: Option<String>,
    settings: Option<String>,
}

static PENDING: Mutex<Vec<LaunchRequest>> = Mutex::new(Vec::new());

/// Answers `--help` and `--version` where the app runs in a terminal (Linux packages put
/// the app itself on PATH as `cairngorm`). Returns true when the app should not start.
pub fn print_info() -> bool {
    match args::parse(std::env::args().skip(1)) {
        Ok(args::Parsed::Help) => print!("{}", args::help(env!("CARGO_PKG_VERSION"))),
        Ok(args::Parsed::Version) => println!("cairngorm {}", env!("CARGO_PKG_VERSION")),
        _ => return false,
    }
    true
}

/// Queues the request this process was started with.
pub fn queue_startup() {
    let cwd = std::env::current_dir().unwrap_or_default();
    if let Some(request) = request(std::env::args().skip(1), &cwd) {
        lock().push(request);
    }
}

/// A second launch: its request goes to the running app (release builds only, like the
/// single-instance handoff).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn submit(app: &AppHandle, argv: Vec<String>, cwd: &str) {
    if let Some(request) = request(argv.into_iter().skip(1), Path::new(cwd)) {
        lock().push(request);
        let _ = app.emit_to("main", EVENT, ());
    }
}

#[tauri::command]
pub fn app_take_launch_requests() -> Vec<LaunchRequest> {
    std::mem::take(&mut *lock())
}

fn lock() -> std::sync::MutexGuard<'static, Vec<LaunchRequest>> {
    PENDING.lock().unwrap_or_else(|e| e.into_inner())
}

/// Invalid arguments are reported and the app still opens; the command validated them.
fn request(argv: impl IntoIterator<Item = String>, cwd: &Path) -> Option<LaunchRequest> {
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let parsed = args::parse(argv).and_then(|parsed| match parsed {
        args::Parsed::Open(request) => request.resolve(cwd, home.as_deref()),
        _ => Ok(args::Request::default()),
    });
    match parsed {
        Ok(request) if request.is_empty() => None,
        Ok(request) => Some(LaunchRequest {
            is_file: request.path.as_deref().is_some_and(Path::is_file),
            path: request.path.map(|p| p.to_string_lossy().into_owned()),
            terminal: request.terminal,
            agent: request.agent,
            panel: request.panel,
            settings: request.settings,
        }),
        Err(error) => {
            eprintln!("[launch] Ignoring arguments: {error}");
            None
        }
    }
}

/// The folder holding a `cairngorm` command for this install. Terminals get it on PATH,
/// even before an installer's PATH change reaches the already-running app:
/// - Windows: `<install>\bin`, which the installer also adds to the user PATH;
/// - macOS: a link to the bundled command in `~/Library/Application Support/Cairngorm/bin`;
/// - Linux AppImage: a link to the AppImage in `~/.local/share/Cairngorm/bin`.
///
/// deb and rpm packages install the app itself as `/usr/bin/cairngorm`.
pub fn command_dir() -> Option<PathBuf> {
    static DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    DIR.get_or_init(find_command_dir).clone()
}

fn find_command_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    if cfg!(windows) {
        let dir = exe.parent()?.join("bin");
        return dir.join("cairngorm.exe").is_file().then_some(dir);
    }
    let home = PathBuf::from(std::env::var_os("HOME")?);
    let (target, dir) = if cfg!(target_os = "macos") {
        (
            exe.parent()?.join("cairngorm-cli"),
            home.join("Library/Application Support/Cairngorm/bin"),
        )
    } else {
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/share"));
        (
            PathBuf::from(std::env::var_os("APPIMAGE")?),
            data.join("Cairngorm/bin"),
        )
    };
    if !target.is_file() {
        return None;
    }
    match link_command(&dir, &target) {
        Ok(()) => Some(dir),
        Err(error) => {
            eprintln!("[launch] Cannot link the cairngorm command: {error}");
            None
        }
    }
}

/// Points `<dir>/cairngorm` at `target`, replacing a link left by an older install.
#[cfg(unix)]
fn link_command(dir: &Path, target: &Path) -> std::io::Result<()> {
    let link = dir.join("cairngorm");
    if std::fs::read_link(&link).is_ok_and(|current| current == target) {
        return Ok(());
    }
    std::fs::create_dir_all(dir)?;
    // Made beside it and renamed over it, so the command is never missing.
    let partial = dir.join(format!(".cairngorm-{}", std::process::id()));
    let _ = std::fs::remove_file(&partial);
    std::os::unix::fs::symlink(target, &partial)?;
    std::fs::rename(&partial, &link)
}

#[cfg(not(unix))]
fn link_command(_dir: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

/// PATH with the command's folder appended once. Development builds skip it: they have
/// no single-instance handoff, so the command would start a second app on the same data.
pub fn path_with_command(path: &str) -> String {
    if cfg!(debug_assertions) {
        return path.to_string();
    }
    let Some(dir) = command_dir() else {
        return path.to_string();
    };
    with_dir(path, &dir)
}

fn with_dir(path: &str, dir: &Path) -> String {
    let separator = if cfg!(windows) { ';' } else { ':' };
    let dir = dir.to_string_lossy();
    let same = |entry: &str| {
        let entry = entry.trim_end_matches(['\\', '/']);
        if cfg!(windows) {
            entry.eq_ignore_ascii_case(&dir)
        } else {
            entry == dir
        }
    };
    if path.split(separator).any(same) {
        return path.to_string();
    }
    if path.is_empty() {
        dir.into_owned()
    } else {
        format!("{path}{separator}{dir}")
    }
}

#[cfg(test)]
#[path = "../../../tests/native/launch-requests.rs"]
mod tests;
