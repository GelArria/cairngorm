// Real agent CLIs in a real PTY: the break these catch is an agent update that renames its
// hook payload field or its resume flag. The CLI starts with the user's own login and the
// hooks Cairngorm installed. Conversations are seeded with a one-line headless prompt, and an
// agent that reports only after a message gets one typed (a few tokens each).
// The process tree is ended after each run.
// Run: cargo test ... --lib --no-default-features session_live -- --ignored --test-threads=1
// CAIRNGORM_LIVE_AGENTS limits the list (default: every catalog agent found on PATH).
use super::{resume, resume_args, Report, AGENTS};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const WAIT: Duration = Duration::from_secs(90);
/// With no report after this long, the test types a one-line message (a few tokens).
const TYPE_AFTER: Duration = Duration::from_secs(25);
const PROMPT: &str = "Reply with the single word ok";

fn on_path(command: &str) -> bool {
    let names: Vec<String> = if cfg!(windows) {
        ["exe", "cmd", "bat", "ps1"]
            .iter()
            .map(|ext| format!("{command}.{ext}"))
            .collect()
    } else {
        vec![command.to_string()]
    };
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|dir| names.iter().any(|n| dir.join(n).is_file()))
    })
}

/// Starts `line` in a shell inside a PTY, answers terminal queries, and waits until `done`
/// says the report is there. The whole process tree is ended either way.
/// Windows hosts run the line in PowerShell, as Cairngorm's restore does (`-NoExit -Command`).
fn run_until(
    line: &str,
    cwd: &Path,
    report: &Path,
    done: impl Fn(&Report) -> bool,
) -> (Option<Report>, String) {
    let pair = NativePtySystem::default()
        .openpty(PtySize {
            rows: 40,
            cols: 140,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut cmd = if cfg!(windows) {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command", line]);
        cmd
    } else {
        let mut cmd = CommandBuilder::new("sh");
        cmd.args(["-lc", line]);
        cmd
    };
    for (key, value) in std::env::vars_os() {
        cmd.env(key, value);
    }
    cmd.env("CAIRNGORM_SESSION_REPORT", report);
    cmd.env("TERM", "xterm-256color");
    cmd.cwd(cwd);
    let mut child = pair.slave.spawn_command(cmd).unwrap();
    drop(pair.slave);
    let writer = Arc::new(Mutex::new(pair.master.take_writer().unwrap()));
    let mut reader = pair.master.try_clone_reader().unwrap();
    let answers = writer.clone();
    let screen = Arc::new(Mutex::new(Vec::<u8>::new()));
    let seen = screen.clone();
    std::thread::spawn(move || {
        let mut bytes = [0u8; 8192];
        while let Ok(n) = reader.read(&mut bytes) {
            if n == 0 {
                break;
            }
            let chunk = &bytes[..n];
            seen.lock().unwrap().extend_from_slice(chunk);
            let mut out = answers.lock().unwrap();
            if chunk.windows(4).any(|w| w == b"\x1b[6n") {
                let _ = out.write_all(b"\x1b[1;1R");
            }
            if chunk.windows(3).any(|w| w == b"\x1b[c") || chunk.windows(4).any(|w| w == b"\x1b[0c")
            {
                let _ = out.write_all(b"\x1b[?62;22c");
            }
        }
    });
    let started = Instant::now();
    let mut typed = false;
    let mut answered: Vec<&str> = Vec::new();
    let found = loop {
        let shown = visible_text(&screen.lock().unwrap());
        // Codex's "update available" list holds the session start: choose "Skip". Its "hooks
        // are new or changed" list is the owner's decision: "Trust all" only when the owner set
        // CAIRNGORM_LIVE_TRUST_CODEX=1 for this run.
        let trust = std::env::var("CAIRNGORM_LIVE_TRUST_CODEX").is_ok_and(|v| v == "1");
        for (marker, allowed) in [("Update now", true), ("Trust all and continue", trust)] {
            if allowed && !answered.contains(&marker) && shown.contains(marker) {
                answered.push(marker);
                std::thread::sleep(Duration::from_millis(1500));
                let _ = writer.lock().unwrap().write_all(b"\x1b[B");
                std::thread::sleep(Duration::from_millis(300));
                let _ = writer.lock().unwrap().write_all(b"\r");
            }
        }
        // Some agents (Droid's TUI) run their session hooks only with the first message.
        if !typed && started.elapsed() > TYPE_AFTER {
            typed = true;
            let _ = writer.lock().unwrap().write_all(PROMPT.as_bytes());
            std::thread::sleep(Duration::from_millis(500));
            let _ = writer.lock().unwrap().write_all(b"\r");
        }
        let parsed = std::fs::read_to_string(report)
            .ok()
            .and_then(|text| serde_json::from_str::<Report>(&text).ok());
        if let Some(parsed) = parsed.filter(|r| done(r)) {
            break Some(parsed);
        }
        if started.elapsed() > WAIT || child.try_wait().ok().flatten().is_some() {
            break None;
        }
        std::thread::sleep(Duration::from_millis(250));
    };
    end_tree(&mut *child);
    let raw = screen.lock().unwrap().clone();
    (found, visible_text(&raw))
}

/// The PTY output without escape sequences, last part only, for failure messages.
fn visible_text(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(n) = chars.next() {
                    if n.is_ascii_alphabetic() || n == '~' {
                        break;
                    }
                }
            } else if chars.peek() == Some(&']') {
                while let Some(n) = chars.next() {
                    if n == '\x07' {
                        break;
                    }
                }
            } else {
                chars.next();
            }
        } else if !c.is_control() || c == '\n' {
            out.push(c);
        }
    }
    let words: Vec<&str> = out.split_whitespace().collect();
    words[words.len().saturating_sub(250)..].join(" ")
}

fn end_tree(child: &mut dyn portable_pty::Child) {
    #[cfg(windows)]
    if let Some(pid) = child.process_id() {
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Runs a one-line prompt headless (the hooks ignore print runs) so the agent saves a real
/// conversation, and returns its id. Uses a few tokens of the user's quota.
fn seed(agent: &str, cwd: &Path) -> Result<String, String> {
    let fixed = uuid::Uuid::new_v4().to_string();
    let line = match agent {
        "claude" => format!("claude -p '{PROMPT}' --model haiku --session-id {fixed}"),
        "pi" => format!("pi -p '{PROMPT}' --session-id {fixed}"),
        "droid" => format!("droid exec -o json '{PROMPT}'"),
        "opencode" => format!("opencode run --format json '{PROMPT}'"),
        "codex" => format!("codex exec --json --skip-git-repo-check '{PROMPT}'"),
        _ => return Err("no headless seed for this agent".into()),
    };
    let output = if cfg!(windows) {
        std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &line])
            .current_dir(cwd)
            .stdin(std::process::Stdio::null())
            .output()
    } else {
        std::process::Command::new("sh")
            .args(["-lc", &line])
            .current_dir(cwd)
            .stdin(std::process::Stdio::null())
            .output()
    }
    .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.status.success() {
        return Err(format!(
            "`{line}` failed: {}{}",
            text,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let key = |keys: &[&str]| {
        text.lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
            .find_map(|v| {
                keys.iter().find_map(|k| {
                    v.get(*k)
                        .or_else(|| v.pointer(&format!("/part/{k}")))
                        .and_then(|x| x.as_str())
                        .map(String::from)
                })
            })
    };
    match agent {
        "claude" | "pi" => Some(fixed),
        "droid" => key(&["session_id", "sessionId"]),
        "opencode" => key(&["sessionID", "session_id"]),
        "codex" => key(&["thread_id", "session_id"]),
        _ => None,
    }
    .ok_or_else(|| format!("`{line}` printed no session id: {text}"))
}

/// Pi resumes by session file; find the one Pi saved for this id.
fn pi_file(id: &str) -> Option<String> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    let root = PathBuf::from(home).join(".pi/agent/sessions");
    std::fs::read_dir(root)
        .ok()?
        .flatten()
        .flat_map(|project| {
            std::fs::read_dir(project.path())
                .into_iter()
                .flatten()
                .flatten()
        })
        .map(|entry| entry.path())
        .find(|path| path.to_string_lossy().ends_with(&format!("_{id}.jsonl")))
        .map(|path| path.to_string_lossy().into_owned())
}

#[test]
#[ignore = "starts the installed agent CLIs with the user's login and spends a few tokens"]
fn installed_agents_report_their_session_and_resume_it() {
    let only = std::env::var("CAIRNGORM_LIVE_AGENTS").ok();
    let cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let dir = std::env::temp_dir().join(format!("cairngorm-live-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut results = Vec::new();
    for (agent, command, ..) in AGENTS {
        let wanted = only
            .as_deref()
            .map_or(true, |list| list.split(',').any(|a| a.trim() == *agent));
        if !wanted || !on_path(command) {
            continue;
        }
        let report = dir.join(format!("{agent}.json"));
        // 1. A fresh start reports the new session (OpenCode only once a conversation exists).
        if *agent != "opencode" {
            let (first, screen) = run_until(command, &cwd, &report, |r| r.agent == *agent);
            results.push(match first {
                Some(first) => format!("{agent}: PASS fresh start reported {}", first.id),
                None => format!(
                    "{agent}: FAIL fresh start wrote no report within {}s; screen: {screen}",
                    WAIT.as_secs()
                ),
            });
        }
        // 2. A saved conversation reopens through Cairngorm's resume command and reports itself.
        let id = match seed(agent, &cwd) {
            Ok(id) => id,
            Err(error) => {
                results.push(format!("{agent}: FAIL seeding a conversation: {error}"));
                continue;
            }
        };
        let path = if *agent == "pi" { pi_file(&id) } else { None };
        let saved: Report = serde_json::from_value(serde_json::json!({
            "agent": agent, "id": id, "path": path, "cwd": cwd.to_string_lossy()
        }))
        .unwrap();
        let Some(line) = resume(&saved, cfg!(windows)) else {
            results.push(format!("{agent}: FAIL no resume command for saved {id}"));
            continue;
        };
        assert!(resume_args(&saved).is_some());
        let _ = std::fs::remove_file(&report);
        let (again, screen) = run_until(&line, &cwd, &report, |r| r.agent == *agent);
        results.push(match again {
            Some(again) if again.id == id => format!("{agent}: PASS `{line}` reopened {id}"),
            Some(again) => format!(
                "{agent}: FAIL `{line}` reported {} instead of {id}",
                again.id
            ),
            None => format!("{agent}: FAIL `{line}` wrote no report; screen: {screen}"),
        });
    }
    let _ = std::fs::remove_dir_all(&dir);
    for line in &results {
        println!("{line}");
    }
    assert!(!results.is_empty(), "no catalog agent found on PATH");
    assert!(results.iter().all(|l| l.contains(": PASS")), "{results:#?}");
}
