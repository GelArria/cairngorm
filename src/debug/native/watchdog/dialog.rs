use super::{FORCE_KILL_AFTER_SECS, SNAPSHOTS};
#[cfg(target_os = "windows")]
pub(super) fn show_hang_dialog(
    hang_secs: u64,
    ui_stuck: bool,
    webview_frozen: bool,
    json_path: &str,
    dmp_path: &Option<String>,
) {
    let (view, heap, rss, lt, stacks) = if let Ok(guard) = SNAPSHOTS.lock() {
        if let Some(s) = guard.front() {
            (
                s.active_view.clone(),
                format!("{}MB", s.heap_mb),
                format!("{}MB", s.rss_mb),
                s.last_longtask.clone(),
                s.last_js_stacks.clone(),
            )
        } else {
            (
                "unknown".to_string(),
                "?".to_string(),
                "?".to_string(),
                "none".to_string(),
                Vec::new(),
            )
        }
    } else {
        (
            "unknown".to_string(),
            "?".to_string(),
            "?".to_string(),
            "none".to_string(),
            Vec::new(),
        )
    };

    let kind = if webview_frozen {
        "WebView Frozen"
    } else if ui_stuck {
        "UI Freeze"
    } else {
        "Not Responding"
    };

    let mut msg = format!(
        "Application frozen for {}s.\r\n\r\nKind: {}\r\nLast view: {}\r\nHeap: {}\r\nRSS: {}\r\nLast longtask: {}\r\n",
        hang_secs, kind, view, heap, rss, lt,
    );

    // Print recent invokes from last snapshot
    if let Ok(guard) = SNAPSHOTS.lock() {
        if let Some(s) = guard.front() {
            if !s.recent_invokes.is_empty() {
                msg.push_str("\r\nRecent invokes:\r\n");
                for inv in &s.recent_invokes {
                    msg.push_str(&format!("  {}\r\n", inv));
                }
            }
        }
    }

    // Print JS stack traces — these are the last samples before the freeze
    if !stacks.is_empty() {
        msg.push_str("\r\n── Last JS Stack Samples ──\r\n");
        for (i, sample) in stacks.iter().rev().take(3).enumerate() {
            let delay_note = if sample.delay_ms > 200.0 {
                format!(
                    "  ⚠ DELAYED {}ms — freeze detected here!",
                    sample.delay_ms as u64
                )
            } else {
                String::new()
            };
            msg.push_str(&format!(
                "\r\n[Sample {}] delay={}ms{}:\r\n",
                i + 1,
                sample.delay_ms as u64,
                delay_note
            ));
            // Truncate stack to keep dialog readable
            let stack: String = sample.stack.chars().take(600).collect();
            msg.push_str(&stack);
            msg.push_str("\r\n");
        }
    }

    msg.push_str(&format!("\r\nDiagnostic files:\r\n  {}\r\n", json_path));
    if let Some(dmp) = dmp_path {
        msg.push_str(&format!("  {}\r\n", dmp));
    }
    msg.push_str(&format!("\r\nForce-closing in {}s.", FORCE_KILL_AFTER_SECS));

    let text: Vec<u8> = msg.bytes().chain(std::iter::once(0u8)).collect();
    let title = b"Freeze Detected\0";

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxA(hwnd: usize, text: *const i8, caption: *const i8, kind: u32) -> i32;
    }

    unsafe {
        // MB_ICONWARNING | MB_SETFOREGROUND | MB_TOPMOST — 0x30 | 0x10000 | 0x40000
        MessageBoxA(
            0,
            text.as_ptr() as *const i8,
            title.as_ptr() as *const i8,
            0x30 | 0x10000 | 0x40000,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub(super) fn show_hang_dialog(
    hang_secs: u64,
    _ui_stuck: bool,
    _webview_frozen: bool,
    json_path: &str,
    _dmp: &Option<String>,
) {
    eprintln!(
        "[HANG] Frozen {}s. Diagnostic: {}. Force exit in {}s.",
        hang_secs, json_path, FORCE_KILL_AFTER_SECS
    );
    // Print last JS stacks to stderr
    if let Ok(guard) = SNAPSHOTS.lock() {
        if let Some(s) = guard.front() {
            for (i, sample) in s.last_js_stacks.iter().rev().take(3).enumerate() {
                eprintln!(
                    "[HANG] Stack sample {} (delay={}ms):\n{}",
                    i + 1,
                    sample.delay_ms as u64,
                    sample.stack
                );
            }
        }
    }
}
