use super::{output::PtyOutput, reader, replay::PtyReplay, test_output::TestOutput};
use portable_pty::{Child, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
pub struct PtySession {
    pub(super) master: Box<dyn MasterPty + Send>,
    pub(super) writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub(super) child: Mutex<Option<Box<dyn Child + Send>>>,
    pub(super) cancel: Arc<AtomicBool>,
    pub(super) reader_alive: Arc<AtomicBool>,
    pub(super) parse_jsonl: bool,
    /// Last visible terminal bytes (post JSONL processing) for replay.
    pub(super) output_log: Arc<Mutex<PtyReplay>>,
    pub(super) output: Arc<PtyOutput>,
    pub(super) test_output: Arc<TestOutput>,
    // Startup output still needs query replies; subsequent attaches are history.
    pub(super) replay_seen: AtomicBool,
    /// Root process id, so plugin bridges spawned by agents can find their terminal.
    pub(super) pid: Option<u32>,
    /// The launch command starts an agent with its permission checks off.
    pub(super) permissions_off: bool,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        // Signal reader thread to stop
        self.cancel.store(true, Ordering::Relaxed);
        self.output.stop();
        if let Some(pid) = self.pid {
            super::forget_pid(pid);
        }
        // Kill child in background thread to avoid blocking spawn_blocking pool
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut c) = child.take() {
                std::thread::spawn(move || {
                    let _ = c.kill();
                    for _ in 0..10 {
                        match c.try_wait() {
                            Ok(Some(_)) | Err(_) => break,
                            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                        }
                    }
                });
            }
        }
    }
}

impl PtySession {
    pub fn new(
        session_id: &str,
        shell: &str,
        args: Vec<String>,
        cwd: Option<String>,
        env: Vec<(String, String)>,
        app: AppHandle,
        parse_jsonl: bool,
        kill_on_agent_end: bool,
    ) -> Result<Self, String> {
        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 2000,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        crate::agent_integrations::install_once();
        crate::claude_statusline::install_once();
        let mut cmd =
            crate::session_report::command(&app, session_id, shell, args, cwd, parse_jsonl)?;
        let argv: Vec<String> = cmd
            .get_argv()
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let permissions_off = crate::launch_permissions::permissions_off(&argv);
        // portable_pty's CommandBuilder calls env_clear() internally,
        // so we must inject system env vars before the caller's overrides.
        let inherit_keys: &[&str] = if cfg!(windows) {
            &[
                "PATH",
                "SystemRoot",
                "USERPROFILE",
                "HOME",
                "TERM",
                "TEMP",
                "TMP",
                "PROGRAMFILES",
                "PROGRAMFILES(X86)",
                "PROGRAMDATA",
                "COMPUTERNAME",
                "USERNAME",
                "PATHEXT",
                "COMSPEC",
                "DRIVERDATA",
                "HOMEDRIVE",
                "HOMEPATH",
                "ALLUSERSPROFILE",
                "OS",
                "PROCESSOR_ARCHITECTURE",
            ]
        } else {
            &[
                "PATH",
                "HOME",
                "TERM",
                "USER",
                "SHELL",
                "LANG",
                "XDG_CONFIG_HOME",
            ]
        };
        for key in inherit_keys {
            if let Ok(val) = std::env::var(key) {
                // The `cairngorm` command works in every terminal, even before the
                // installer's PATH change reaches this already-running app.
                let val = if *key == "PATH" {
                    crate::launch_requests::path_with_command(&val)
                } else {
                    val
                };
                cmd.env(key, val);
            }
        }
        // Identify the actual terminal, not the terminal that launched Cairngorm.
        cmd.env("TERM", "xterm-256color");
        cmd.env("TERM_PROGRAM", "Cairngorm");
        // Plugin bridges report this; agents that filter the environment are matched by pid.
        cmd.env("CAIRNGORM_TERMINAL", session_id);
        // Apply caller env overrides on top of inherited env
        for (k, v) in env {
            cmd.env(k, v);
        }

        if let Err(error) = crate::test_browser::configure(&app, session_id, &mut cmd) {
            eprintln!("[testing] Could not enable browser observation: {error}");
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| {
            crate::test_browser::release(session_id);
            crate::session_report::release(session_id);
            e.to_string()
        })?;
        let pid = child.process_id();
        if let Some(pid) = pid {
            super::remember_pid(pid, session_id);
        }
        let writer = Arc::new(Mutex::new(
            pair.master.take_writer().map_err(|e| e.to_string())?,
        ));
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_reader = cancel.clone();

        // Pass session_id into the reader thread for dynamic event names
        let sid_reader = session_id.to_string();
        let app_reader = app.clone();
        let writer_reader = writer.clone();
        let output_log = Arc::new(Mutex::new(PtyReplay::default()));
        let output_log_reader = output_log.clone();
        let reader_alive = Arc::new(AtomicBool::new(true));
        let reader_alive_clone = reader_alive.clone();
        let output = Arc::new(PtyOutput::default());
        let output_reader = output.clone();
        let test_output = Arc::new(TestOutput::new(session_id));
        let test_output_reader = test_output.clone();

        reader::spawn_reader(
            reader,
            reader::ReaderContext {
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
            },
        );

        Ok(PtySession {
            master: pair.master,
            writer,
            child: Mutex::new(Some(child)),
            cancel,
            reader_alive,
            parse_jsonl,
            output_log,
            output,
            test_output,
            replay_seen: AtomicBool::new(false),
            pid,
            permissions_off,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().unwrap();
        match writer.write_all(data) {
            Ok(_) => match writer.flush() {
                Ok(_) => Ok(()),
                Err(e) => {
                    eprintln!("[pty] flush failed: {}", e);
                    Err(e.to_string())
                }
            },
            Err(e) => {
                eprintln!("[pty] write_all failed: {}", e);
                Err(e.to_string())
            }
        }
    }

    pub fn is_reader_alive(&self) -> bool {
        self.reader_alive.load(Ordering::Relaxed)
    }

    pub fn is_child_alive(&self) -> bool {
        let mut child = self.child.lock().unwrap();
        match child.as_mut() {
            None => false,
            Some(c) => match c.try_wait() {
                Ok(Some(_)) => {
                    *child = None;
                    false
                }
                Ok(None) => true,
                Err(_) => {
                    *child = None;
                    false
                }
            },
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let cols = if self.parse_jsonl {
            cols.max(2000)
        } else {
            cols
        };
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) -> Result<(), String> {
        self.cancel.store(true, Ordering::Relaxed);
        self.output.stop();
        let mut child = self.child.lock().unwrap();
        if let Some(ref mut c) = *child {
            c.kill().map_err(|e| e.to_string())?;
            for _ in 0..20 {
                match c.try_wait() {
                    Ok(Some(_)) | Err(_) => {
                        *child = None;
                        return Ok(());
                    }
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                }
            }
        }
        *child = None;
        Ok(())
    }
}
