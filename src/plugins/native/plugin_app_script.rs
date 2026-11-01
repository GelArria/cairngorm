//! Runs an agent's script inside an installed application through its own automation API.
//! On Windows the script is PowerShell with `$app` bound to the application's COM object:
//! the running instance when there is one, otherwise a new one. Nothing is reimplemented here;
//! every feature is the application's own.
use super::app_discovery::App;
use serde_json::Value;
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub const MAX_SCRIPT_BYTES: usize = 64 * 1024;

/// The request's time limit, and what is left of it for the script.
#[derive(Clone, Copy)]
pub(super) struct Budget {
    pub limit: Duration,
    pub left: Duration,
}

/// A trivial request in this platform's scripting language: it answers only when the
/// application takes calls again.
pub(super) fn probe() -> &'static str {
    if cfg!(target_os = "macos") {
        "app.name();"
    } else {
        "$null = $app.Name"
    }
}
#[cfg(test)]
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// Text for a PowerShell single-quoted string: every character PowerShell treats as a single
/// quote (ASCII and typographic) is doubled, so a value like `O’Brien` cannot end the string.
pub(super) fn quoted(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| match c {
            '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => vec![c, c],
            c => vec![c],
        })
        .collect()
}

/// Read the automated instance's active window without changing its documents or stdout.
pub(super) fn capture_window(file: &Path) -> String {
    let file = quoted(&file.to_string_lossy());
    format!(
        "$windowHwnd = 0\n\
try {{ $windowHwnd = [long]$app.ActiveWindow.Hwnd }} catch {{ }}\n\
if (-not $windowHwnd) {{ try {{ $windowHwnd = [long]$app.Hwnd }} catch {{ }} }}\n\
if ($windowHwnd -lt 0) {{ $windowHwnd += 4294967296 }}\n\
if ($windowHwnd) {{ try {{ [IO.File]::WriteAllText('{file}', [string]$windowHwnd) }} catch {{ }} }}"
    )
}

/// The script with `$app` prepared. `$started` is true only when a new process of the
/// application appeared (never guessed from a failed lookup); its ids go to `pids` so a
/// timeout can end it. A new instance nobody can see is closed afterwards; the user's own
/// instances are never closed.
pub(super) fn wrap(app: &App, script: &str, pids: &Path) -> String {
    let prog_id = quoted(&app.prog_id);
    let image = quoted(
        Path::new(&app.executable)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default(),
    );
    let capture = capture_window(&pids.with_extension("window"));
    let pids = quoted(&pids.to_string_lossy());
    format!(
        "$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n\
[Console]::OutputEncoding = [Text.Encoding]::UTF8\n\
$before = @(Get-Process -Name '{image}' -ErrorAction SilentlyContinue | ForEach-Object Id)\n\
$app = $null\n\
try {{ $app = [Runtime.InteropServices.Marshal]::GetActiveObject('{prog_id}') }} catch {{ }}\n\
if (-not $app) {{ $app = New-Object -ComObject '{prog_id}' }}\n\
$new = @(Get-Process -Name '{image}' -ErrorAction SilentlyContinue | ForEach-Object Id | Where-Object {{ $before -notcontains $_ }})\n\
$started = $new.Count -gt 0\n\
if ($started) {{ Set-Content -LiteralPath '{pids}' -Value ($new -join ',') }}\n\
try {{\n& {{\n{script}\n}}\n}} finally {{\n\
{capture}\n\
  if ($started) {{\n\
    $visible = $false; try {{ $visible = [bool]$app.Visible }} catch {{ }}\n\
    if (-not $visible) {{\n\
      try {{ $app.DisplayAlerts = $false }} catch {{ }}\n\
      try {{ $app.Quit() }} catch {{ }}\n\
      Start-Sleep -Milliseconds 500\n\
      foreach ($id in $new) {{ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }}\n\
    }}\n\
  }}\n\
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)\n}}\n"
    )
}

fn lock_for(id: &str) -> Arc<Mutex<()>> {
    static LOCKS: Mutex<Option<HashMap<String, Arc<Mutex<()>>>>> = Mutex::new(None);
    let mut locks = LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    locks
        .get_or_insert_with(HashMap::new)
        .entry(id.to_string())
        .or_default()
        .clone()
}

/// Ends instances the script started (recorded in `pids`) when it was stopped early, except
/// one with a visible window: the user may be working in it, so it is never killed.
#[cfg(windows)]
fn end_started(app: &App, pids: &Path) {
    let Ok(text) = std::fs::read_to_string(pids) else {
        return;
    };
    let image = Path::new(&app.executable)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut system = sysinfo::System::new();
    for pid in text
        .trim()
        .split(',')
        .filter_map(|p| p.trim().parse::<u32>().ok())
    {
        let pid = sysinfo::Pid::from_u32(pid);
        system.refresh_process(pid);
        if let Some(process) = system.process(pid) {
            if process.name().to_lowercase() == image
                && !super::app_window::has_window(pid.as_u32())
            {
                process.kill();
            }
        }
    }
}

/// Runs the agent's script in the application through this platform's automation:
/// COM through Windows PowerShell, Apple events through JavaScript for Automation on macOS.
/// One script at a time per application, so two scripts never share (and quit) an instance.
/// The request began at `begun`; the script gets what is left of `limit` once it is its turn.
pub(super) fn run(
    app: &App,
    script: &str,
    cwd: &Path,
    limit: Duration,
    begun: Instant,
) -> Result<Value, String> {
    let lock = lock_for(&app.id);
    let _turn = lock.lock().unwrap_or_else(|e| e.into_inner());
    let budget = Budget {
        limit,
        left: limit
            .saturating_sub(begun.elapsed())
            .max(Duration::from_secs(1)),
    };
    #[cfg(windows)]
    return run_com(app, script, cwd, budget);
    #[cfg(target_os = "macos")]
    return super::app_osa::run(app, script, cwd, budget);
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, script, cwd, budget);
        Err("Scripting installed applications is available on Windows and macOS; on Linux, applications with their own MCP server are driven with cairngorm_app_call.".into())
    }
}

#[cfg(windows)]
fn run_com(app: &App, script: &str, cwd: &Path, budget: Budget) -> Result<Value, String> {
    let base = std::env::temp_dir().join(format!("cairngorm-app-{}", uuid::Uuid::new_v4()));
    let (file, pids) = (base.with_extension("ps1"), base.with_extension("pids"));
    // UTF-8 with BOM: Windows PowerShell reads non-ASCII scripts correctly only then.
    let mut text = vec![0xEF, 0xBB, 0xBF];
    text.extend_from_slice(wrap(app, script, &pids).as_bytes());
    std::fs::write(&file, text).map_err(|e| e.to_string())?;
    let mut command = std::process::Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&file)
        .current_dir(cwd);
    let finished = super::app_run::supervise(command, app, budget.left);
    // A dialog waits for the user: the application stays exactly as it is.
    if let Ok(finished) = &finished {
        if finished.stop.is_some()
            && !matches!(finished.stop, Some(super::app_watch::Stop::Dialog(_)))
        {
            end_started(app, &pids);
        }
    }
    let window_file = pids.with_extension("window");
    let window = std::fs::metadata(&window_file)
        .ok()
        .filter(|metadata| metadata.len() <= 20)
        .and_then(|_| std::fs::read_to_string(&window_file).ok())
        .and_then(|hwnd| hwnd.parse::<isize>().ok())
        .filter(|hwnd| *hwnd > 0);
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_file(&pids);
    let _ = std::fs::remove_file(&window_file);
    let mut report = super::app_run::report(app, finished?, budget.limit);
    if let Some(window) = window {
        report["windowHwnd"] = serde_json::json!(window.to_string());
    }
    Ok(report)
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_script.rs"]
mod tests;
