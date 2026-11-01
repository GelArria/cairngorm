//! Discovers an application's real window; docking never reimplements its UI.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppWindow {
    /// Window handle, as a decimal string for JavaScript.
    pub hwnd: String,
    pub title: String,
}

#[cfg(windows)]
#[path = "plugin_app_window_win.rs"]
mod win;
#[cfg(windows)]
pub use win::{
    alive, cancel_close, dock, focus, is_docked, prepare_close, release, release_all,
    session_closed, Hwnd,
};

/// Validate only the window's process, not the entire process table per installed app.
#[cfg(windows)]
pub fn scriptable(hwnd: Hwnd) -> bool {
    let mut system = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(win::process(hwnd));
    system.refresh_process(pid);
    let Some(executable) = system.process(pid).and_then(|process| process.exe()) else {
        return false;
    };
    super::app_discovery::apps(false)
        .iter()
        .any(|app| same_executable(executable, std::path::Path::new(&app.executable)))
}

fn same_executable(left: &std::path::Path, right: &std::path::Path) -> bool {
    let (Ok(left), Ok(right)) = (left.canonicalize(), right.canonicalize()) else {
        return false;
    };
    left.to_string_lossy()
        .eq_ignore_ascii_case(&right.to_string_lossy())
}

/// Running processes of exactly this executable. Called every second while a request runs, so
/// one process table is kept and refreshed with names and (once per process) paths only.
/// macOS shortens process names, so there only the path decides.
pub fn pids(executable: &str) -> Vec<u32> {
    use sysinfo::{ProcessRefreshKind, UpdateKind};
    static SYSTEM: std::sync::Mutex<Option<sysinfo::System>> = std::sync::Mutex::new(None);
    let executable = std::path::Path::new(executable);
    let Some(image) = executable.file_name().map(|n| n.to_string_lossy()) else {
        return Vec::new();
    };
    let mut guard = SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
    let system = guard.get_or_insert_with(sysinfo::System::new);
    system
        .refresh_processes_specifics(ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet));
    system
        .processes()
        .iter()
        .filter(|(_, process)| !cfg!(windows) || process.name().eq_ignore_ascii_case(&image))
        .filter(|(_, process)| {
            process
                .exe()
                .is_some_and(|path| same_executable(path, executable))
        })
        .map(|(pid, _)| pid.as_u32())
        .collect()
}

/// The process shows a window the user can see (and may be working in).
#[cfg(windows)]
pub fn has_window(pid: u32) -> bool {
    !win::windows_of(&[pid]).is_empty()
}

/// Resolve the exact window reported by automation, never one from another process.
#[cfg(windows)]
pub fn reported_window(executable: &str, hwnd: &str) -> Option<AppWindow> {
    let hwnd: Hwnd = hwnd.parse().ok()?;
    let hwnd = win::root(hwnd);
    if !alive(hwnd) {
        return None;
    }
    let pid = win::process(hwnd);
    let mut system = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(pid);
    system.refresh_process(pid);
    let path = system.process(pid)?.exe()?;
    if !same_executable(path, std::path::Path::new(executable))
        || (!is_docked(hwnd) && !win::windows_of(&[pid.as_u32()]).contains(&hwnd))
    {
        return None;
    }
    Some(AppWindow {
        hwnd: hwnd.to_string(),
        title: win::title(hwnd),
    })
}

#[cfg(not(windows))]
pub fn reported_window(_: &str, _: &str) -> Option<AppWindow> {
    None
}

/// The application's largest visible top-level window, matched by executable path.
#[cfg(windows)]
pub fn main_window(executable: &str) -> Option<AppWindow> {
    let pids = pids(executable);
    let hwnd = win::windows_of(&pids)
        .into_iter()
        .max_by_key(|&hwnd| win::area(hwnd))?;
    Some(AppWindow {
        hwnd: hwnd.to_string(),
        title: win::title(hwnd),
    })
}

#[cfg(not(windows))]
pub fn main_window(_: &str) -> Option<AppWindow> {
    None
}
