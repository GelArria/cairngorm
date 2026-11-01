#[path = "watchdog/diagnostics.rs"]
mod diagnostics;
#[path = "watchdog/dialog.rs"]
mod dialog;
#[path = "watchdog/minidump.rs"]
mod minidump;
use diagnostics::save_diagnostics;
use dialog::show_hang_dialog;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

static LAST_HEARTBEAT: AtomicI64 = AtomicI64::new(0);
static HANG_NOTIFIED: AtomicI64 = AtomicI64::new(0);
static LAST_PONG: AtomicI64 = AtomicI64::new(0);

lazy_static::lazy_static! {
    static ref WATCHDOG_HANDLE: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);
    static ref SNAPSHOTS: Mutex<VecDeque<DiagSnapshot>> = Mutex::new(VecDeque::new());
}

const HANG_THRESHOLD_SECS: u64 = 45;
const FORCE_KILL_AFTER_SECS: u64 = 30;

// ── Snapshot types ──────────────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StackSample {
    pub time: i64,
    pub delay_ms: f64,
    pub stack: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiagSnapshot {
    pub timestamp: String,
    pub active_view: String,
    pub heap_mb: u64,
    pub last_longtask: String,
    pub recent_invokes: Vec<String>,
    pub long_task_count: u64,
    pub rss_mb: u64,
    pub ui_stuck: bool,
    #[serde(default)]
    pub last_js_stacks: Vec<StackSample>,
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn heartbeat(snapshot: DiagSnapshot) {
    LAST_HEARTBEAT.store(epoch_secs(), Ordering::Relaxed);
    HANG_NOTIFIED.store(0, Ordering::Relaxed);
    if let Ok(mut guard) = SNAPSHOTS.lock() {
        guard.push_front(snapshot);
        guard.truncate(3);
    }
}

#[tauri::command]
pub fn pong() {
    LAST_PONG.store(epoch_secs(), Ordering::Relaxed);
}

static PAUSED: AtomicBool = AtomicBool::new(false);

/// Background mode keeps agents running behind hidden windows for hours. A suspended page
/// there must not end them, so hang checks stop and restart with a fresh grace period.
pub fn set_paused(paused: bool) {
    if !paused {
        LAST_HEARTBEAT.store(epoch_secs() + 10, Ordering::Relaxed);
        LAST_PONG.store(epoch_secs() + 10, Ordering::Relaxed);
    }
    PAUSED.store(paused, Ordering::Relaxed);
}

// ── Init ────────────────────────────────────────────────────────────────────

pub fn init_watchdog(app: &tauri::AppHandle) {
    *WATCHDOG_HANDLE.lock().unwrap() = Some(app.clone());
    LAST_HEARTBEAT.store(epoch_secs() + 10, Ordering::Relaxed);
    LAST_PONG.store(epoch_secs() + 10, Ordering::Relaxed);

    // Ping emitter — asks frontend to respond every 5s via event
    let ping_handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let _ = crate::emit_safe::emit_bg(&ping_handle, "watchdog-ping", ());
    });

    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        if PAUSED.load(Ordering::Relaxed) {
            continue;
        }
        let now = epoch_secs();
        let last = LAST_HEARTBEAT.load(Ordering::Relaxed);
        let elapsed = now - last;
        let notified = HANG_NOTIFIED.load(Ordering::Relaxed);

        // Check if latest snapshot reports UI stuck
        let ui_stuck = if let Ok(guard) = SNAPSHOTS.lock() {
            guard.front().map(|s| s.ui_stuck).unwrap_or(false)
        } else {
            false
        };

        // Also check pong staleness — webview event loop may be frozen
        // even if heartbeat still arrives (timers run but event loop stuck)
        let pong_age = now - LAST_PONG.load(Ordering::Relaxed);
        let webview_frozen = pong_age > 15 && pong_age > elapsed;

        let is_hang = (heartbeat_hang(elapsed, pong_age) && notified == 0)
            // A hidden window paints no frames, so "stuck" also needs a stale pong.
            || (ui_stuck && elapsed >= 15 && pong_age > 15 && notified == 0)
            || (webview_frozen && notified == 0);

        if is_hang {
            HANG_NOTIFIED.store(now, Ordering::Relaxed);
            if ui_stuck {
                eprintln!(
                    "\n═══ UI FREEZE ═══\nFrontend reports UI stuck for {}s\n═════════════════",
                    elapsed
                );
            } else if webview_frozen {
                eprintln!(
                    "\n═══ WEBVIEW FREEZE ═══\nNo pong response for {}s\n═══════════════════════",
                    pong_age
                );
            } else {
                eprintln!(
                    "\n═══ APP HANG ═══\nNo heartbeat for {}s\n═════════════════",
                    elapsed
                );
            }

            // Print last JS stack traces to stderr immediately
            if let Ok(guard) = SNAPSHOTS.lock() {
                if let Some(s) = guard.front() {
                    if !s.last_js_stacks.is_empty() {
                        eprintln!("\n── Last JS Stack Samples ──");
                        for (i, sample) in s.last_js_stacks.iter().rev().take(3).enumerate() {
                            let delay_note = if sample.delay_ms > 200.0 {
                                format!(" ⚠ DELAYED {}ms — freeze here!", sample.delay_ms as u64)
                            } else {
                                String::new()
                            };
                            eprintln!(
                                "\n[Sample {}] delay={}ms{}:\n{}",
                                i + 1,
                                sample.delay_ms as u64,
                                delay_note,
                                sample.stack
                            );
                        }
                    }
                    if !s.recent_invokes.is_empty() {
                        eprintln!("\n── Recent Invokes ──");
                        for inv in &s.recent_invokes {
                            eprintln!("  {}", inv);
                        }
                    }
                }
            }

            if let Ok(g) = WATCHDOG_HANDLE.lock() {
                if let Some(h) = g.as_ref() {
                    let _ = crate::emit_safe::emit_bg(h, "app-hang", elapsed as u64);
                }
            }

            let (json_path, dmp_path) = save_diagnostics(&handle, elapsed as u64);
            show_hang_dialog(
                elapsed as u64,
                ui_stuck,
                webview_frozen,
                &json_path,
                &dmp_path,
            );

            // After dialog: wait and check if heartbeat recovered
            let hang_time = HANG_NOTIFIED.load(Ordering::Relaxed);
            let mut alive = false;
            for _ in 0..FORCE_KILL_AFTER_SECS {
                std::thread::sleep(Duration::from_secs(1));
                let current_last = LAST_HEARTBEAT.load(Ordering::Relaxed);
                let current_pong = LAST_PONG.load(Ordering::Relaxed);
                if recovered(hang_time, current_last, current_pong) {
                    eprintln!("═══ APP RECOVERED ═══");
                    HANG_NOTIFIED.store(0, Ordering::Relaxed);
                    alive = true;
                    break;
                }
            }

            // Closing ends every terminal and agent: only a webview that answered neither
            // a heartbeat nor a pong during the grace period is closed.
            if !alive {
                eprintln!(
                    "═══ FORCE KILL ═══ No recovery after {}s",
                    FORCE_KILL_AFTER_SECS
                );
                crate::plugins::release_app_windows();
                std::process::exit(1);
            }
        }
    });
}

/// A late heartbeat alone is not a freeze: hidden or minimized pages throttle timers (to about
/// once a minute after five minutes), while the pong, answered from an event, keeps arriving.
fn heartbeat_hang(heartbeat_age: i64, pong_age: i64) -> bool {
    heartbeat_age >= HANG_THRESHOLD_SECS as i64 && pong_age > 15
}

/// Either signal newer than the hang means the webview is responding again.
fn recovered(hang_time: i64, last_heartbeat: i64, last_pong: i64) -> bool {
    last_heartbeat > hang_time || last_pong > hang_time
}

// ── Save diagnostics ───────────────────────────────────────────────────────

fn epoch_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
#[path = "../../../tests/native/watchdog.rs"]
mod tests;
