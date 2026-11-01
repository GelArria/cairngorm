use super::kill_session;
use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;
/// Extract complete lines from `buf` (split on `\n`, dropping a preceding `\r`).
/// Remainder stays in `buf` for the next chunk.
pub(super) fn process_lines(buf: &mut Vec<u8>, mut on_line: impl FnMut(&[u8])) {
    let mut start = 0;
    for i in 0..buf.len() {
        if buf[i] == b'\n' {
            let mut end = i;
            if end > start && buf[end - 1] == b'\r' {
                end -= 1;
            }
            on_line(&buf[start..end]);
            start = i + 1;
        }
    }
    if start > 0 {
        buf.drain(..start);
    }
}

/// Try to parse a single UTF-8 line as a JSON object. Non-JSON lines are ignored.
/// Finds the first '{' and parses to its matching '}', ignoring trailing content
/// (e.g., ConPTY escape sequences mixed into the line).
#[cfg(test)]
pub(super) fn try_parse_jsonl(line: &[u8]) -> Option<Value> {
    let bytes = extract_json_bytes(line)?;
    serde_json::from_slice(bytes).ok()
}

/// Remove CSI escape sequences (`\x1b[...final`) from a byte fragment.
/// ConPTY injects them even into wrapped agent JSON; raw `\x1b` bytes are
/// invalid JSON and would poison the reassembly (reviewer P3).
pub(super) fn strip_ansi(line: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(line.len());
    let mut i = 0;
    while i < line.len() {
        if line[i] == 0x1b && i + 1 < line.len() && line[i + 1] == b'[' {
            let mut j = i + 2;
            while j < line.len() && !(0x40..=0x7e).contains(&line[j]) {
                j += 1;
            }
            if j < line.len() {
                i = j + 1;
                continue;
            }
        }
        out.push(line[i]);
        i += 1;
    }
    out
}

/// Extract the raw bytes of the first JSON object in a line (from first '{' to its matching '}').
pub(super) fn extract_json_bytes(line: &[u8]) -> Option<&[u8]> {
    let start = line.iter().position(|&b| b == b'{')?;
    let sub = &line[start..];
    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in sub.iter().enumerate() {
        if esc {
            esc = false;
            continue;
        }
        if b == b'\\' && in_str {
            esc = true;
            continue;
        }
        if b == b'"' {
            in_str = !in_str;
            continue;
        }
        if in_str {
            continue;
        }
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&sub[..=i]);
                }
            }
            _ => {}
        }
    }
    None
}

pub(super) fn schedule_kill_after_agent_end(session_id: &str) {
    let sid = session_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(500));
        kill_session(&sid);
    });
}

/// Generate human-readable terminal text from a parsed JSONL event.
/// Returns None for events that produce no visible terminal output.
pub(super) fn format_event_for_terminal(event: &Value) -> Option<String> {
    let event_type = event.get("type")?.as_str()?;
    match event_type {
        "sidecar_ready" => {
            let model = event
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            let profile = event.get("profile").and_then(|p| p.as_str()).unwrap_or("");
            Some(format!(
                "cairngorm-agent | {} | {}\nType a message, or use Chat UI. Ctrl+C to exit.\n\n",
                model, profile
            ))
        }
        "message_update" => {
            let delta = event
                .get("assistantMessageEvent")
                .and_then(|e| e.get("delta"))
                .and_then(|d| d.as_str());
            delta.map(|d| d.to_string())
        }
        "message_end" => {
            let msg = event.get("message")?;
            let stop_reason = msg.get("stopReason").and_then(|s| s.as_str());
            if stop_reason == Some("error") {
                let err = msg
                    .get("errorMessage")
                    .and_then(|e| e.as_str())
                    .unwrap_or("unknown error");
                Some(format!("\n[error] {}\n", err))
            } else {
                None
            }
        }
        "tool_execution_start" => {
            let name = event
                .get("toolName")
                .and_then(|n| n.as_str())
                .unwrap_or("tool");
            Some(format!("\n[tool] {}...\n", name))
        }
        "tool_execution_end" => {
            let is_error = event
                .get("isError")
                .and_then(|e| e.as_bool())
                .unwrap_or(false);
            Some(if is_error {
                "  -> FAILED\n".to_string()
            } else {
                "  -> done\n".to_string()
            })
        }
        "turn_end" => Some("\n\n".to_string()),
        "agent_end" => Some("\n".to_string()),
        _ => None,
    }
}

/// Emit a parsed JSONL event with the PTY session_id override.
/// Returns (was_json, terminal_text):
///   was_json = true if the line was consumed as a JSONL event
///   terminal_text = human-readable text to show in xterm (may be empty)
pub(super) fn handle_jsonl_event(
    app: &AppHandle,
    session_id: &str,
    event: Option<Value>,
    kill_on_agent_end: bool,
) -> (bool, Vec<u8>) {
    match event {
        Some(mut value) => {
            let evt_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("?");
            // "prompt" and "steer" are inputs (ConPTY echo): render them as transcript
            // in the TUI instead of suppressing them, so the user sees their messages (and the
            // ones arriving via Chat UI / detached window) next to the responses.
            if evt_type == "prompt" || evt_type == "steer" {
                let content = value
                    .get("content")
                    .and_then(|c| c.as_str())
                    .or_else(|| value.get("instruction").and_then(|i| i.as_str()))
                    .unwrap_or("");
                let text = if evt_type == "prompt" {
                    format!("\r\n\x1b[36m❯ {}\x1b[0m\r\n", content)
                } else {
                    format!("\r\n\x1b[33m[steer] {}\x1b[0m\r\n", content)
                };
                return (true, text.into_bytes());
            }
            let is_end = evt_type == "agent_end";
            // Override session_id to match the PTY tab's session
            if let Some(obj) = value.as_object_mut() {
                obj.insert(
                    "session_id".to_string(),
                    Value::String(session_id.to_string()),
                );
            }
            // Format while borrowed, then move the Value into the safe event queue.
            // Cloning full message/tool payloads here doubled their allocations.
            let term_text = format_event_for_terminal(&value)
                .map(|s| s.into_bytes())
                .unwrap_or_default();
            let _ = crate::emit_safe::emit_bg(app, "agent-event", value);
            if kill_on_agent_end && is_end {
                schedule_kill_after_agent_end(session_id);
            }
            (true, term_text)
        }
        None => (false, Vec::new()), // non-JSON — caller forwards to xterm
    }
}
