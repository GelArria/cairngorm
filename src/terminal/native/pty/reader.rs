use super::{
    emit_terminal_output, output::PtyOutput, replay::PtyReplay, test_output::TestOutput,
    PtyDataPayload, PtyExitPayload,
};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub(super) struct ReaderContext {
    pub session_id: String,
    pub app: AppHandle,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub cancel: Arc<AtomicBool>,
    pub output_log: Arc<Mutex<PtyReplay>>,
    pub reader_alive: Arc<AtomicBool>,
    pub output: Arc<PtyOutput>,
    pub test_output: Arc<TestOutput>,
    pub parse_jsonl: bool,
    pub kill_on_agent_end: bool,
}

pub(super) fn spawn_reader(reader: Box<dyn Read + Send>, context: ReaderContext) {
    let ReaderContext {
        session_id: sid_reader,
        app: app_reader,
        writer: writer_reader,
        cancel: cancel_reader,
        output_log: output_log_reader,
        reader_alive: reader_alive_clone,
        output: output_reader,
        test_output: test_output_reader,
        parse_jsonl,
        kill_on_agent_end,
    } = context;
    std::thread::spawn(move || {
        let mut reader = reader;
        let data_event = format!("pty-data-{}", sid_reader);
        let mut read_buf = [0u8; 4096];
        let mut decoder = super::decoder::JsonlDecoder::default();
        loop {
            if cancel_reader.load(Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut read_buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &read_buf[..n];

                    // Only headless sidecars need a backend CPR reply; xterm answers normal
                    // terminals. Duplicate replies make PSReadLine consume the first key.
                    if parse_jsonl && chunk.windows(4).any(|w| w == b"\x1b[6n") {
                        if let Ok(mut w) = writer_reader.lock() {
                            let _ = w.write_all(b"\x1b[1;1R");
                            let _ = w.flush();
                        }
                    }

                    if parse_jsonl {
                        // Agent sidecar mode: split into lines.
                        // JSON lines → agent-event (filtered from xterm).
                        // Non-JSON lines → pty-data (visible in xterm).
                        // ConPTY wraps long JSON lines at terminal width,
                        // inserting \r\n at wrap points. We reassemble them.
                        let non_json_buf =
                            decoder.push(chunk, &app_reader, &sid_reader, kill_on_agent_end);
                        if !non_json_buf.is_empty() {
                            output_log_reader.lock().unwrap().push(&non_json_buf);
                            test_output_reader.push(&app_reader, &non_json_buf);
                            let encoded = base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                &non_json_buf,
                            );
                            let _ = crate::emit_safe::emit_bg(
                                &app_reader,
                                &format!("pty-data-{}", sid_reader),
                                PtyDataPayload { data: encoded },
                            );
                        }
                    } else {
                        // Coalesce regular terminal bursts before base64/JSON IPC.
                        output_log_reader.lock().unwrap().push(chunk);
                        test_output_reader.push(&app_reader, chunk);
                        if !emit_terminal_output(&app_reader, &data_event, &output_reader, chunk) {
                            break;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[pty] reader error sid={}: {}", sid_reader, e);
                    break;
                }
            }
        }
        eprintln!("[pty] reader thread EXIT sid={}", sid_reader);
        test_output_reader.finish(&app_reader);
        output_reader.stop();
        reader_alive_clone.store(false, Ordering::Relaxed);
        crate::test_browser::release(&sid_reader);
        if !cancel_reader.load(Ordering::Relaxed) {
            crate::session_report::release(&sid_reader);
        }
        let _ = crate::emit_safe::emit_bg(
            &app_reader,
            &format!("pty-exit-{}", sid_reader),
            PtyExitPayload {},
        );
    });
}
