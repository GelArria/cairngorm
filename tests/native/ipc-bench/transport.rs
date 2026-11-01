// Native IPC experiment only: no PTYs, database, credentials or app state.
use super::*;
use base64::Engine;
use tauri::{ipc::{Channel, JavaScriptChannelId, Response}, Webview};

pub const LINE: &[u8] = b"\x1b[32mCairngorm \xf0\x9f\xa6\x80 IPC stream fixture \x1b[0m\r\n";

#[tauri::command]
pub fn bench_ping() -> &'static str { "pong" }

#[tauri::command]
pub fn bench_stream(
    app: AppHandle, webview: Webview, mode: String,
    sessions: usize, bytes: usize, channels: Vec<JavaScriptChannelId>,
) -> Result<(), String> {
    if !matches!(mode.as_str(), "events" | "coalesced" | "raw" | "raw-batch")
        || !(1..=4).contains(&sessions) || !(1..=16 * 1024 * 1024).contains(&bytes) {
        return Err("Invalid benchmark parameters".into());
    }
    if mode.starts_with("raw") && channels.len() != sessions { return Err("Missing channels".into()); }
    for sid in 0..sessions {
        let app = app.clone();
        let mode = mode.clone();
        let channel: Option<Channel<Response>> = channels.get(sid).map(|id| id.channel_on(webview.clone()));
        std::thread::spawn(move || {
            let output = Arc::new(PtyOutput::default());
            let name = format!("bench-data-{sid}");
            let chunk_size = if mode == "raw-batch" { OUTPUT_CAP } else { 4096 };
            for offset in (0..bytes).step_by(chunk_size) {
                let data: Vec<u8> = (offset..(offset + chunk_size).min(bytes)).map(|i| LINE[i % LINE.len()]).collect();
                if mode == "coalesced" {
                    // The runner compiles the actual helper from pty.rs, not a model of it.
                    if !emit_terminal_output(&app, &name, &output, &data) { return; }
                } else if mode == "events" {
                    let payload = PtyDataPayload { data: base64::engine::general_purpose::STANDARD.encode(data) };
                    let (handle, name) = (app.clone(), name.clone());
                    if app.run_on_main_thread(move || { let _ = handle.emit(&name, payload); }).is_err() { return; }
                } else {
                    let sender = channel.as_ref().unwrap().clone();
                    if app.run_on_main_thread(move || { let _ = sender.send(Response::new(data)); }).is_err() { return; }
                }
            }
            output.stop();
            let handle = app.clone();
            // Same-channel EOF preserves order even when large raw bodies use async fetch.
            let _ = app.run_on_main_thread(move || {
                if let Some(sender) = channel { let _ = sender.send(Response::new(Vec::<u8>::new())); }
                else { let _ = handle.emit(&format!("bench-exit-{sid}"), ()); }
            });
        });
    }
    Ok(())
}
