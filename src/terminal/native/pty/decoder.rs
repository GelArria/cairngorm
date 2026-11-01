use super::jsonl::{extract_json_bytes, handle_jsonl_event, process_lines, strip_ansi};
use tauri::AppHandle;

#[derive(Default)]
pub(super) struct JsonlDecoder {
    line_buf: Vec<u8>,
    json_assembly: Vec<u8>,
    seen_json: std::collections::HashSet<Vec<u8>>,
}
impl JsonlDecoder {
    pub fn push(
        &mut self,
        chunk: &[u8],
        app: &AppHandle,
        session_id: &str,
        kill_on_agent_end: bool,
    ) -> Vec<u8> {
        let Self {
            line_buf,
            json_assembly,
            seen_json,
        } = self;
        line_buf.extend_from_slice(chunk);
        let mut non_json_buf: Vec<u8> = Vec::new();
        // Oversized agent JSON (a long reply makes each message_update line
        // carry the full partial message): once a line outgrows the cap we
        // swallow its remaining fragments instead of spilling raw JSON
        // into the xterm. Ends when a fragment closes with '}'.
        let mut discarding_oversize = false;
        process_lines(line_buf, |line| {
            if discarding_oversize {
                if line.last() == Some(&b'}') {
                    discarding_oversize = false;
                }
                return;
            }
            if line.is_empty() {
                // Mid-assembly: the wrapped JSON continues after the wrap
                // break — flushing here spilled raw agent JSON into the xterm.
                if json_assembly.is_empty() {
                    non_json_buf.push(b'\n');
                }
                return;
            }
            // If assembling wrapped JSON, append and retry
            if !json_assembly.is_empty() {
                // ANSI stripped: ConPTY injects escapes even into wrapped
                // agent JSON — raw \x1b bytes poison serde parsing.
                json_assembly.extend_from_slice(&strip_ansi(line));
                if json_assembly.len() > 8_000_000 {
                    // Hard ceiling: no sane agent event is this big. Drop and
                    // swallow the rest of the line until it closes (P2 reviewer:
                    // completing lines under the ceiling still parse through —
                    // large-but-valid tool results reach the TUI/chat).
                    json_assembly.clear();
                    discarding_oversize = true;
                    return;
                }
                let json = extract_json_bytes(&json_assembly);
                if json.is_some_and(|bytes| seen_json.contains(bytes)) {
                    json_assembly.clear();
                    return;
                }
                let event = json.and_then(|bytes| serde_json::from_slice(bytes).ok());
                let (was_json, term_text) =
                    handle_jsonl_event(app, session_id, event, kill_on_agent_end);
                if was_json {
                    if let Some(bytes) = json {
                        seen_json.insert(bytes.to_vec());
                        if seen_json.len() > 50 {
                            seen_json.clear();
                        }
                    }
                    json_assembly.clear();
                    if !term_text.is_empty() {
                        non_json_buf.extend_from_slice(&term_text);
                    }
                }
                // else: keep assembling (parses when the closing fragment lands)
                return;
            }
            // Try this line as complete JSON
            // Dedup: ConPTY echoes agent output. Track seen JSON
            // byte sequences and skip duplicates (echoes).
            let json = extract_json_bytes(line);
            if json.is_some_and(|bytes| seen_json.contains(bytes)) {
                return;
            }
            let event = json.and_then(|bytes| serde_json::from_slice(bytes).ok());
            let (was_json, term_text) =
                handle_jsonl_event(app, session_id, event, kill_on_agent_end);
            if was_json {
                if let Some(bytes) = json {
                    seen_json.insert(bytes.to_vec());
                    if seen_json.len() > 50 {
                        seen_json.clear();
                    }
                }
            }
            if !was_json {
                // If line contains '{', might be start of wrapped JSON.
                // ANSI stripped: ConPTY injects escapes even into wrapped
                // agent JSON — raw \x1b bytes poison serde parsing.
                let clean = strip_ansi(line);
                if clean.contains(&b'{') {
                    json_assembly.extend_from_slice(&clean);
                } else if !line.is_empty() && line[0] == 0x1b {
                    // Skip pure ANSI escape sequences (ConPTY screen management)
                } else {
                    non_json_buf.extend_from_slice(line);
                    non_json_buf.push(b'\n');
                }
            } else if !term_text.is_empty() {
                non_json_buf.extend_from_slice(&term_text);
            }
        });
        // Flush partial non-JSON line (no trailing \n yet).
        if !line_buf.is_empty()
            && !line_buf.contains(&b'{')
            && json_assembly.is_empty()
            && line_buf[0] != 0x1b
        {
            non_json_buf.extend_from_slice(line_buf);
            line_buf.clear();
        }

        non_json_buf
    }
}
