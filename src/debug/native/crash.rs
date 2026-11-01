use std::panic::{self, PanicHookInfo};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

lazy_static::lazy_static! {
    static ref CRASH_APP_HANDLE: Mutex<Option<tauri::AppHandle>> = Mutex::new(None);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Clone)]
struct CrashPayload {
    source: &'static str,
    message: String,
    location: String,
    stacktrace: String,
    timestamp: String,
}

fn time_from_secs(mut s: u64) -> (u64, u64, u64, u64, u64, u64) {
    let h = (s / 3600) % 24;
    let mi = (s / 60) % 60;
    let sec = s % 60;
    s /= 86400;
    let mut y = 1970;
    loop {
        let dy = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
            366
        } else {
            365
        };
        if s < dy {
            break;
        }
        s -= dy;
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
    let mut mo = 1;
    for &d in &md {
        if s < d {
            break;
        }
        s -= d;
        mo += 1;
    }
    (y, mo, s + 1, h, mi, sec)
}

fn panic_hook(info: &PanicHookInfo) {
    crate::plugins::release_app_windows();
    let message = info
        .payload()
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| info.payload().downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_string());

    let location = info
        .location()
        .map(|l| format!("{}:{}", l.file(), l.line()))
        .unwrap_or_default();

    let bt = backtrace::Backtrace::new();
    let stacktrace = format!("{:?}", bt);

    let timestamp = {
        let dur = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let secs = dur.as_secs();
        let (y, mo, d, h, mi, s) = time_from_secs(secs);
        format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, mi, s)
    };

    let payload = CrashPayload {
        source: "rust",
        message: message.clone(),
        location: location.clone(),
        stacktrace: stacktrace.clone(),
        timestamp,
    };

    eprintln!(
        "\n═══ RUST PANIC ═══\nMessage: {}\nLocation: {}\nStacktrace:\n{}\n═════════════════",
        payload.message, payload.location, payload.stacktrace
    );

    // 1) Try to emit to frontend so it can show CrashDialog
    if let Ok(guard) = CRASH_APP_HANDLE.lock() {
        if let Some(handle) = guard.as_ref() {
            let _ = crate::emit_safe::emit_bg(handle, "app-crash", payload);
        }
    }

    // 2) Give frontend 1.5s to render CrashDialog before process exits
    sleep(Duration::from_millis(1500));

    // 3) Native fallback — show MessageBoxA if frontend didn't catch it
    // (e.g. webview frozen, process dying too fast, etc.)
    show_native_crash_dialog(&message, &location);
}

#[cfg(target_os = "windows")]
fn show_native_crash_dialog(message: &str, location: &str) {
    let mut msg = format!("Application crashed:\n\n{}", message);
    if !location.is_empty() {
        msg.push_str(&format!("\n\nAt: {}", location));
    }
    msg.push_str("\n\nCheck %APPDATA%\\Cairngorm\\logs\\ for diagnostics.");
    let text: Vec<u8> = msg.bytes().chain(std::iter::once(0u8)).collect();
    let title = b"Application Crashed\0";

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxA(hwnd: usize, text: *const i8, caption: *const i8, kind: u32) -> i32;
    }

    unsafe {
        MessageBoxA(
            0,
            text.as_ptr() as *const i8,
            title.as_ptr() as *const i8,
            0x00000010,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn show_native_crash_dialog(message: &str, location: &str) {
    eprintln!("[CRASH] {} at {}", message, location);
}

pub fn init(app: &tauri::AppHandle) {
    *CRASH_APP_HANDLE.lock().unwrap() = Some(app.clone());
    panic::set_hook(Box::new(panic_hook));
}

#[tauri::command]
pub fn exit_app() {
    crate::plugins::release_app_windows();
    std::process::exit(1);
}

#[tauri::command]
pub fn test_panic() {
    panic!("Test panic triggered — verifying crash handler works");
}
