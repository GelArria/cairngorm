//! Runs one agent script for an application, on every platform: in its own process tree (a
//! kill-on-close job on Windows, a process group elsewhere), with bounded output, while
//! `app_watch` decides whether it must stop (time limit, cancellation, a dialog).
use super::{app_discovery::App, app_watch};
use serde_json::{json, Value};
use std::{
    io::Read,
    process::{Command, ExitStatus, Stdio},
    time::{Duration, Instant},
};

pub(super) const MAX_OUTPUT_BYTES: usize = 256 * 1024;

pub struct Finished {
    pub status: Option<ExitStatus>,
    pub stop: Option<app_watch::Stop>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub started: Instant,
}

pub(super) fn capped(bytes: Vec<u8>) -> (String, bool) {
    let truncated = bytes.len() > MAX_OUTPUT_BYTES;
    let end = bytes.len().min(MAX_OUTPUT_BYTES);
    (
        String::from_utf8_lossy(&bytes[..end]).into_owned(),
        truncated,
    )
}

fn drain(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(pipe) = pipe {
            let _ = pipe
                .take(MAX_OUTPUT_BYTES as u64 + 1)
                .read_to_end(&mut buffer);
        }
        buffer
    })
}

/// Starts `command` in its own process tree and waits until it ends or must stop. Ending the
/// tree ends everything the script started, except applications started for it by the
/// system (COM, Apple events), which the caller handles.
pub fn supervise(mut command: Command, app: &App, timeout: Duration) -> Result<Finished, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW | CREATE_SUSPENDED: in the job before anything runs.
        command.creation_flags(0x0800_0004);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let started = Instant::now();
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut tree = match crate::ai_process::ProcessTree::watch(&child) {
        Ok(tree) => Some(tree),
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };
    let (out, err) = (drain(child.stdout.take()), drain(child.stderr.take()));
    let mut watch = app_watch::Watch::new(timeout, super::app_cancel::current());
    let (status, stop) = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break (Some(status), None);
        }
        let now = Instant::now();
        let seen = watch
            .scan_due(now)
            .then(|| app_watch::observe(&app.executable));
        if let Some(stop) = watch.check(now, seen.as_ref()) {
            // The tree first: on Unix the group is killed while its leader still holds the id.
            drop(tree.take());
            let _ = child.kill();
            let _ = child.wait();
            break (None, Some(stop));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    drop(tree);
    Ok(Finished {
        status,
        stop,
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
        started,
    })
}

/// The agent's result: output, exit code and, for a stopped script, why (`stopped`) and what
/// to do (`message`). The application is marked as possibly busy after a stop.
pub fn report(app: &App, finished: Finished, timeout: Duration) -> Value {
    super::app_busy::finished(&app.id, finished.stop.is_some());
    let (stdout, out_cut) = capped(finished.stdout);
    let (stderr, err_cut) = capped(finished.stderr);
    let stop = finished.stop.as_ref();
    json!({
        "app": app.id,
        "exitCode": finished.status.and_then(|s| s.code()),
        "timedOut": matches!(stop, Some(app_watch::Stop::TimedOut { .. })),
        "stopped": stop.map(|s| s.code()),
        "message": stop.map(|s| s.message(&app.name, timeout)),
        "stdout": stdout,
        "stderr": stderr,
        "truncated": out_cut || err_cut,
        "durationMs": finished.started.elapsed().as_millis() as u64,
    })
}
