use std::sync::{Arc, Mutex};
use std::time::Instant;

#[tauri::command]
pub fn is_debug() -> bool {
    cfg!(debug_assertions)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
    rss_mb: f64,
    uptime_secs: f64,
}

lazy_static::lazy_static! {
    static ref APP_START: Instant = Instant::now();
    static ref SYS_INFO: Arc<Mutex<sysinfo::System>> = Arc::new(Mutex::new(sysinfo::System::new()));
}

#[tauri::command(async)]
pub fn get_perf_stats() -> PerfStats {
    let mut sys = SYS_INFO.lock().unwrap();
    let pid = sysinfo::Pid::from_u32(std::process::id());
    sys.refresh_process(pid); // only our own process — a full process-table refresh costs ~10x more
    let rss_mb = sys
        .process(pid)
        .map(|p| p.memory() as f64 / 1024.0 / 1024.0)
        .unwrap_or(0.0);
    let uptime_secs = APP_START.elapsed().as_secs_f64();
    PerfStats {
        rss_mb,
        uptime_secs,
    }
}

// ── App Entry ───────────────────────────────────────────────────────────────
