use super::{
    find_session, kill_session, session_slot, test_observer, PtySession, PtySlot, PTY_REGISTRY,
};
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::AppHandle;
#[derive(Serialize, Clone)]
pub struct PtyDataPayload {
    pub data: String, // base64
}

#[derive(Serialize, Clone)]
pub struct PtyExitPayload {}

/// What a renderer learns when it ensures a terminal, whether it started or was running.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyEnsured {
    /// The launch command starts an agent with its permission checks off.
    permissions_off: bool,
}

impl PtyEnsured {
    fn of(session: &PtySession) -> Self {
        Self {
            permissions_off: session.permissions_off,
        }
    }
}

#[tauri::command]
pub async fn pty_test_run(session_id: String) -> Result<Option<test_observer::TestUpdate>, String> {
    crate::blocking(move || {
        find_session(&session_id).and_then(|slot| {
            slot.lock()
                .unwrap()
                .as_ref()
                .and_then(|session| session.test_output.snapshot())
        })
    })
    .await
}

#[tauri::command]
pub async fn pty_ensure(
    app: AppHandle,
    session_id: String,
    shell: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Vec<(String, String)>,
    parse_jsonl: Option<bool>,
    kill_on_agent_end: Option<bool>,
) -> Result<PtyEnsured, String> {
    let parse_jsonl = parse_jsonl.unwrap_or(false);
    let kill_on_agent_end = kill_on_agent_end.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        loop {
            let slot = session_slot(&session_id);
            let mut session = slot.lock().unwrap();
            // A kill may have removed our slot while we waited: retry instead of
            // spawning into an orphan slot that commands can no longer find.
            if !find_session(&session_id).is_some_and(|current| Arc::ptr_eq(&current, &slot)) {
                continue;
            }
            if let Some(s) = session.as_ref() {
                if s.is_reader_alive() && s.is_child_alive() {
                    return Ok(PtyEnsured::of(s));
                }
            }
            // Same-session ensure calls share this lock, so only one child is spawned.
            // Keep an empty slot after a failed spawn: a waiting retry must reuse it.
            session.take();
            let env = if parse_jsonl {
                // Ignore renderer-supplied credentials and resolve them at the
                // native process boundary after validating the sidecar executable.
                crate::agent_env::launch_environment(&shell, &args)?
                    .into_iter()
                    .collect()
            } else {
                env
            };
            let started = PtySession::new(
                &session_id,
                &shell,
                args,
                cwd,
                env,
                app,
                parse_jsonl,
                kill_on_agent_end,
            )
            .map_err(|err| {
                crate::session_report::release(&session_id);
                err
            })?;
            let ensured = PtyEnsured::of(&started);
            *session = Some(started);
            return Ok(ensured);
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Record live external agents before a normal close, while their PTYs still exist.
#[tauri::command]
pub async fn pty_snapshot_sessions(app: AppHandle) -> Result<(), String> {
    crate::blocking(move || {
        let slots: Vec<_> = PTY_REGISTRY
            .lock()
            .unwrap()
            .iter()
            .map(|(id, slot)| (id.clone(), slot.clone()))
            .collect();
        let mut terminals = Vec::new();
        for (id, slot) in slots {
            let session = slot.lock().unwrap();
            let Some(session) = session.as_ref().filter(|s| !s.parse_jsonl) else {
                continue;
            };
            let pid = if session.is_child_alive() {
                Some(
                    session
                        .pid
                        .ok_or_else(|| format!("Cannot inspect terminal {id}"))?,
                )
            } else {
                None
            };
            terminals.push((id, pid));
        }
        crate::session_report::capture(&app, terminals)
    })
    .await?
}

/// Terminals still doing work: a live agent sidecar, or a pane running more than its shell.
/// Closing the window with any of them keeps the app running in the background.
#[tauri::command]
pub async fn pty_busy_count() -> Result<usize, String> {
    crate::blocking(|| {
        let slots: Vec<PtySlot> = PTY_REGISTRY.lock().unwrap().values().cloned().collect();
        let mut sidecars = 0;
        let mut roots = Vec::new();
        for slot in slots {
            let session = slot.lock().unwrap();
            let Some(session) = session.as_ref().filter(|s| s.is_child_alive()) else {
                continue;
            };
            if session.parse_jsonl {
                sidecars += 1;
            } else if let Some(pid) = session.pid {
                roots.push(pid);
            }
        }
        sidecars + crate::session_report::busy_panes(&roots)
    })
    .await
}

/// Send a steering instruction to a JSONL sidecar via its PTY stdin.
#[tauri::command]
pub async fn agent_steer(
    session_id: String,
    instruction: String,
    mode: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(slot) = find_session(&session_id) else {
            return Ok(());
        };
        let session = slot.lock().unwrap();
        let Some(session) = session.as_ref() else {
            return Ok(());
        };
        let cmd = serde_json::json!({
            "type": "steer",
            "instruction": instruction,
            "mode": mode.unwrap_or_default(),
        });
        let bytes = format!("{}\n", cmd).into_bytes();
        session.write(&bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pty_write(session_id: String, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(slot) = find_session(&session_id) else {
            eprintln!("[pty_write] SESSION NOT FOUND: {}", session_id);
            return Ok(());
        };
        let session = slot.lock().unwrap();
        let Some(session) = session.as_ref() else {
            return Ok(());
        };
        let bytes = data.into_bytes();
        let bytes: Vec<u8> = if cfg!(windows) {
            let mut out = Vec::with_capacity(bytes.len() * 2);
            let mut prev = 0u8;
            for &b in &bytes {
                if b == b'\n' && prev != b'\r' {
                    out.push(b'\r');
                }
                out.push(b);
                prev = b;
            }
            out
        } else {
            bytes
        };
        session.write(&bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pty_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(slot) = find_session(&session_id) else {
            return Ok(());
        };
        let session = slot.lock().unwrap();
        let Some(session) = session.as_ref() else {
            return Ok(());
        };
        session.resize(cols, rows)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pty_kill(session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        kill_session(&session_id);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns base64 output and whether a terminal has already requested a snapshot.
/// Best-effort: None if the session does not exist or there is no buffered output.
#[tauri::command]
pub async fn pty_replay(session_id: String) -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(slot) = find_session(&session_id) else {
            return Ok(None);
        };
        let session = slot.lock().unwrap();
        let Some(session) = session.as_ref() else {
            return Ok(None);
        };
        let historical = session.replay_seen.swap(true, Ordering::SeqCst);
        let replay = session.output_log.lock().unwrap().replay();
        if replay.is_empty() {
            return Ok(None);
        }
        let size = session.master.get_size().ok();
        Ok(Some(serde_json::json!({
            "data": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, replay),
            "historical": historical,
            "size": size.map(|size| serde_json::json!({ "cols": size.cols, "rows": size.rows })),
        })))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Kill all PTY sessions. Called on app exit.
pub fn pty_cleanup_all() {
    let mut registry = PTY_REGISTRY.lock().unwrap();
    let slots: Vec<(String, PtySlot)> = registry.drain().collect();
    drop(registry); // release lock before blocking
    for (id, slot) in slots {
        crate::test_browser::release(&id);
        crate::session_report::release(&id);
        if let Ok(mut session) = slot.lock() {
            if let Some(s) = session.take() {
                let _ = s.kill();
            }
        }
    }
}
