//! A stdio MCP client for an application's own server. A writer thread owns stdin and a reader
//! thread routes replies, so no caller ever blocks on a pipe: every request is bounded by its
//! timeout. A session that stops reading, writing or answering is dead and is replaced.
use super::{
    app_mcp::McpServer,
    app_mcp_io::{read, write, Failure, Pending},
};
use serde_json::{json, Value};
use std::{
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

const PROTOCOL: &str = "2025-06-18";

pub struct Session {
    server: McpServer,
    child: Mutex<Child>,
    outbox: mpsc::Sender<Value>,
    pending: Pending,
    dead: Arc<AtomicBool>,
    next_id: AtomicU64,
    /// Kill-on-close job (Windows) or process group (Unix): ending it ends the server's tree.
    tree: Option<crate::ai_process::ProcessTree>,
}

impl Session {
    pub fn start(server: &McpServer, cwd: &Path) -> Result<Self, Failure> {
        let mut command = Command::new(&server.program);
        command
            .args(&server.args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
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
        let mut child = command.spawn().map_err(|e| {
            Failure::Unavailable(format!("Could not start the application's MCP server: {e}"))
        })?;
        let tree = match crate::ai_process::ProcessTree::watch(&child) {
            Ok(tree) => tree,
            Err(error) => {
                let _ = child.kill();
                return Err(Failure::Unavailable(error));
            }
        };
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            return Err(Failure::Unavailable(
                "The application's MCP server has no stdio.".into(),
            ));
        };
        let (outbox, queued) = mpsc::channel();
        let pending: Pending = Arc::default();
        let dead = Arc::new(AtomicBool::new(false));
        let writer_dead = dead.clone();
        std::thread::spawn(move || write(stdin, queued, writer_dead));
        let (replies, waiting, reader_dead) = (outbox.clone(), pending.clone(), dead.clone());
        std::thread::spawn(move || read(stdout, replies, waiting, reader_dead));
        let session = Self {
            server: server.clone(),
            child: Mutex::new(child),
            outbox,
            pending,
            dead,
            next_id: AtomicU64::new(1),
            tree: Some(tree),
        };
        let client = json!({ "name": "Cairngorm", "version": env!("CARGO_PKG_VERSION") });
        session.request(
            "initialize",
            json!({ "protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": client }),
            Duration::from_secs(30),
        )?;
        let _ = session
            .outbox
            .send(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}));
        Ok(session)
    }

    pub fn alive(&self) -> bool {
        if self.dead.load(Ordering::SeqCst) {
            return false;
        }
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        matches!(child.try_wait(), Ok(None))
    }

    pub fn serves(&self, server: &McpServer) -> bool {
        &self.server == server
    }

    /// The `result` of one JSON-RPC request. A server that does not answer in time is dead:
    /// the next use starts a fresh one. A cancelled request is cancelled at the server too,
    /// which stays in use.
    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, Failure> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, sender);
        // Checked after registering: a reader that ended meanwhile has cleared it or will.
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let reply = if self.dead.load(Ordering::SeqCst) || self.outbox.send(body).is_err() {
            Err(Failure::Stopped)
        } else {
            self.wait(id, &receiver, timeout)
        };
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        let reply = reply?;
        if let Some(error) = reply.get("error") {
            return Err(Failure::Server(
                error["message"]
                    .as_str()
                    .unwrap_or("The application reported an error.")
                    .to_string(),
            ));
        }
        Ok(reply["result"].clone())
    }

    fn wait(
        &self,
        id: u64,
        reply: &mpsc::Receiver<Value>,
        timeout: Duration,
    ) -> Result<Value, Failure> {
        let cancel = super::app_cancel::current();
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match reply.recv_timeout(left.min(Duration::from_millis(250))) {
                Ok(message) => return Ok(message),
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(Failure::Stopped),
                Err(mpsc::RecvTimeoutError::Timeout) if left.is_zero() => {
                    self.dead.store(true, Ordering::SeqCst);
                    return Err(Failure::TimedOut(timeout));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if cancel
                .as_ref()
                .is_some_and(super::app_cancel::Token::cancelled)
            {
                let _ = self.outbox.send(
                    json!({"jsonrpc": "2.0", "method": "notifications/cancelled",
                    "params": {"requestId": id, "reason": "Cancelled by the agent"}}),
                );
                return Err(Failure::Cancelled);
            }
        }
    }
}

impl Drop for Session {
    /// The tree goes first (on Unix the group is killed while its leader still exists),
    /// then the server itself is ended and reaped.
    fn drop(&mut self) {
        self.dead.store(true, Ordering::SeqCst);
        drop(self.tree.take());
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_mcp_session.rs"]
mod tests;
