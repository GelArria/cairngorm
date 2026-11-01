#[path = "pty/commands.rs"]
mod commands;
#[path = "pty/decoder.rs"]
mod decoder;
#[path = "pty/jsonl.rs"]
mod jsonl;
#[path = "pty/reader.rs"]
mod reader;
#[path = "pty/session.rs"]
mod session;
pub use commands::*;
#[cfg(test)]
use jsonl::*;
pub use session::PtySession;
use std::collections::HashMap;
#[path = "./pty_output.rs"]
mod output;
#[path = "./pty_replay.rs"]
mod replay;
#[path = "../../testing/native/test_observer.rs"]
mod test_observer;
#[path = "../../testing/native/test_output.rs"]
mod test_output;
use lazy_static::lazy_static;
use output::{PtyOutput, OUTPUT_CAP};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

// Reserve a per-session slot before spawning. Only map access holds the registry:
// slow spawn/write/resize/kill on one terminal never blocks another terminal.
type PtySlot = Arc<Mutex<Option<PtySession>>>;
lazy_static! {
    static ref PTY_REGISTRY: Mutex<HashMap<String, PtySlot>> = Mutex::new(HashMap::new());
}

lazy_static! {
    // Separate from the registry: lookups never wait on a terminal's slot lock.
    static ref PTY_PIDS: Mutex<HashMap<u32, String>> = Mutex::new(HashMap::new());
}

fn remember_pid(pid: u32, session_id: &str) {
    PTY_PIDS.lock().unwrap().insert(pid, session_id.to_string());
}

fn forget_pid(pid: u32) {
    PTY_PIDS.lock().unwrap().remove(&pid);
}

/// Whether a terminal session with this id is live in this app.
pub fn session_exists(id: &str) -> bool {
    find_session(id).is_some()
}

/// The terminal whose root process is `pid`.
pub fn session_for_pid(pid: u32) -> Option<String> {
    PTY_PIDS.lock().unwrap().get(&pid).cloned()
}

fn session_slot(id: &str) -> PtySlot {
    PTY_REGISTRY
        .lock()
        .unwrap()
        .entry(id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(None)))
        .clone()
}

fn find_session(id: &str) -> Option<PtySlot> {
    PTY_REGISTRY.lock().unwrap().get(id).cloned()
}

fn kill_session(id: &str) {
    crate::plugins::release_terminal(id);
    crate::test_browser::release(id);
    let Some(slot) = find_session(id) else {
        crate::session_report::release(id);
        return;
    };
    let mut session = slot.lock().unwrap();
    if let Some(s) = session.take() {
        let _ = s.kill();
    }
    crate::session_report::release(id);
    // Keep the slot registered until killing finishes. A concurrent ensure must
    // wait on this same lock, not start a second child while the first is dying.
    let mut registry = PTY_REGISTRY.lock().unwrap();
    if registry
        .get(id)
        .is_some_and(|current| Arc::ptr_eq(current, &slot))
    {
        registry.remove(id);
    }
}

// Keep emission on the main thread (emit_safe's deadlock rule). There is at
// most one queued callback and 64 KiB pending per terminal, with no new threads.
fn emit_terminal_output(
    app: &AppHandle,
    event: &str,
    output: &Arc<PtyOutput>,
    data: &[u8],
) -> bool {
    for chunk in data.chunks(OUTPUT_CAP) {
        let Some(schedule) = output.push(chunk) else {
            return false;
        };
        if !schedule {
            continue;
        }
        let pending = output.clone();
        let event = event.to_owned();
        if crate::emit_safe::on_main_app(app, move |handle| {
            let _ = handle.emit(
                &event,
                PtyDataPayload {
                    data: pending.take(),
                },
            );
        })
        .is_err()
        {
            output.stop();
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::replay::push_ring;
    use super::*;
    use std::collections::VecDeque;

    #[test]
    fn push_ring_appends_and_trims_to_cap() {
        let mut buf = VecDeque::new();
        push_ring(&mut buf, b"hello ", 8);
        push_ring(&mut buf, b"world!", 8);
        assert_eq!(buf.make_contiguous(), b"o world!"); // keeps the most recent (cap 8)
        push_ring(&mut buf, b"X", 8);
        assert_eq!(buf.make_contiguous(), b" world!X");
    }

    #[test]
    fn push_ring_keeps_all_under_cap() {
        let mut buf = VecDeque::new();
        push_ring(&mut buf, b"abc", 100);
        assert_eq!(buf.make_contiguous(), b"abc");
    }

    #[test]
    fn process_lines_splits_across_chunks() {
        let mut buf = Vec::new();
        let mut lines = Vec::new();
        buf.extend_from_slice(b"{\"a\":1}\n{\"b\"");
        process_lines(&mut buf, |line| lines.push(line.to_vec()));
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], b"{\"a\":1}");
        assert_eq!(buf, b"{\"b\"");

        buf.extend_from_slice(b":2}\n");
        process_lines(&mut buf, |line| lines.push(line.to_vec()));
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[1], b"{\"b\":2}");
        assert!(buf.is_empty());
    }

    #[test]
    fn process_lines_handles_crlf() {
        let mut buf = Vec::new();
        let mut lines = Vec::new();
        buf.extend_from_slice(b"line1\r\nline2\r\n");
        process_lines(&mut buf, |line| {
            lines.push(String::from_utf8_lossy(line).to_string())
        });
        assert_eq!(lines, vec!["line1", "line2"]);
        assert!(buf.is_empty());
    }

    #[test]
    fn try_parse_jsonl_accepts_valid_object() {
        let line = br#"{"type":"agent_start","session_id":"s1"}"#;
        let value = try_parse_jsonl(line).unwrap();
        assert_eq!(value["type"], "agent_start");
        assert_eq!(value["session_id"], "s1");
    }

    #[test]
    fn try_parse_jsonl_skips_malformed_and_non_json() {
        assert!(try_parse_jsonl(b"not-json{").is_none());
        assert!(try_parse_jsonl(b"{broken").is_none());
        assert!(try_parse_jsonl(b"").is_none());
    }

    #[test]
    fn try_parse_jsonl_returns_none_for_plain_text() {
        // Plain text lines (non-JSON) should return None so they forward to xterm
        assert!(try_parse_jsonl(b"Error: something failed").is_none());
        assert!(try_parse_jsonl(b"  indented text").is_none());
        assert!(try_parse_jsonl(b"hello world").is_none());
    }

    #[test]
    fn burst_lines_no_drops() {
        let mut buf = Vec::new();
        let mut lines = Vec::new();
        let count = 1200;
        let payload: String = (0..count).map(|i| format!("{{\"n\":{}}}\n", i)).collect();
        // Feed in small chunks to simulate real pipe reads.
        for chunk in payload.as_bytes().chunks(64) {
            buf.extend_from_slice(chunk);
            process_lines(&mut buf, |line| {
                if !line.is_empty() {
                    lines.push(String::from_utf8_lossy(line).to_string());
                }
            });
        }
        assert_eq!(lines.len(), count);
        // Verify last parsed value.
        let last: serde_json::Value = serde_json::from_str(&lines[count - 1]).unwrap();
        assert_eq!(last["n"], count - 1);
    }
}

#[cfg(all(test, windows))]
#[path = "../../../tests/native/conpty-mouse.rs"]
mod conpty_mouse_tests;
#[cfg(all(test, windows))]
#[path = "../../../tests/native/pty-contention.rs"]
mod contention_tests;
