use crate::claude_statusline::{install, read_usage, USAGE_FILE};
use serde_json::Value;
use std::{fs, path::PathBuf};

/// A fresh folder, removed when the test ends.
struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let dir =
            std::env::temp_dir().join(format!("cairngorm-statusline-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn settings(dir: &std::path::Path) -> Value {
    serde_json::from_str(&fs::read_to_string(dir.join("settings.json")).unwrap()).unwrap()
}

#[test]
fn installs_the_relay_and_keeps_other_settings() {
    let dir = TempDir::new();
    fs::write(dir.0.as_path().join("settings.json"), r#"{"model":"opus"}"#).unwrap();
    install(dir.0.as_path()).unwrap();
    let value = settings(dir.0.as_path());
    assert_eq!(value["model"], "opus");
    assert_eq!(value["statusLine"]["type"], "command");
    assert!(value["statusLine"]["command"]
        .as_str()
        .unwrap()
        .contains("cairngorm-statusline"));
    assert!(!dir
        .0
        .as_path()
        .join("hooks/cairngorm-statusline.chain")
        .exists());
    // Idempotent: a second run leaves the file alone.
    let before = fs::read_to_string(dir.0.as_path().join("settings.json")).unwrap();
    install(dir.0.as_path()).unwrap();
    assert_eq!(
        fs::read_to_string(dir.0.as_path().join("settings.json")).unwrap(),
        before
    );
}

#[test]
fn an_existing_status_line_still_runs_through_the_relay() {
    let dir = TempDir::new();
    fs::write(
        dir.0.as_path().join("settings.json"),
        r#"{"statusLine":{"type":"command","command":"my-line --fancy","padding":2}}"#,
    )
    .unwrap();
    install(dir.0.as_path()).unwrap();
    let value = settings(dir.0.as_path());
    assert_eq!(value["statusLine"]["padding"], 2);
    assert_ne!(value["statusLine"]["command"], "my-line --fancy");
    let chain =
        fs::read_to_string(dir.0.as_path().join("hooks/cairngorm-statusline.chain")).unwrap();
    assert_eq!(chain, "my-line --fancy");
}

#[test]
fn invalid_settings_are_reported_not_rewritten() {
    let dir = TempDir::new();
    fs::write(dir.0.as_path().join("settings.json"), "{ not json").unwrap();
    assert!(install(dir.0.as_path()).is_err());
    assert_eq!(
        fs::read_to_string(dir.0.as_path().join("settings.json")).unwrap(),
        "{ not json"
    );
}

#[test]
fn saved_limits_become_windows_and_expired_ones_read_as_reset() {
    let dir = TempDir::new();
    assert!(read_usage(dir.0.as_path(), 1000).is_none());
    fs::write(
        dir.0.as_path().join(USAGE_FILE),
        r#"{"updatedAt":900,"fiveHour":{"used_percentage":34,"resets_at":500},"sevenDay":{"used_percentage":12.5,"resets_at":5000}}"#,
    )
    .unwrap();
    let (updated, windows) = read_usage(dir.0.as_path(), 1000).unwrap();
    assert_eq!(updated, Some(900));
    assert_eq!(windows[0].label, "5-hour");
    assert_eq!(windows[0].used_percent, 0.0);
    assert_eq!(windows[0].resets_at, None);
    assert_eq!(windows[1].label, "Weekly");
    assert_eq!(windows[1].used_percent, 12.5);
    assert_eq!(windows[1].resets_at, Some(5000));
}

#[test]
fn our_relay_at_another_path_is_replaced_not_chained() {
    let dir = TempDir::new();
    fs::write(
        dir.0.join("settings.json"),
        r#"{"statusLine":{"type":"command","command":"powershell.exe -File \"D:/old/.claude/hooks/cairngorm-statusline.ps1\""}}"#,
    )
    .unwrap();
    install(&dir.0).unwrap();
    assert!(settings(&dir.0)["statusLine"]["command"]
        .as_str()
        .unwrap()
        .contains(&dir.0.to_string_lossy().to_string()));
    assert!(!dir.0.join("hooks/cairngorm-statusline.chain").exists());
}

#[test]
fn a_status_line_without_command_drops_a_stale_chain() {
    let dir = TempDir::new();
    fs::create_dir_all(dir.0.join("hooks")).unwrap();
    fs::write(dir.0.join("hooks/cairngorm-statusline.chain"), "old-line").unwrap();
    fs::write(
        dir.0.join("settings.json"),
        r#"{"statusLine":{"padding":1}}"#,
    )
    .unwrap();
    install(&dir.0).unwrap();
    assert_eq!(settings(&dir.0)["statusLine"]["padding"], 1);
    assert!(!dir.0.join("hooks/cairngorm-statusline.chain").exists());
}

#[test]
fn a_status_line_changed_later_is_chained_again() {
    let dir = TempDir::new();
    fs::write(
        dir.0.join("settings.json"),
        r#"{"statusLine":{"type":"command","command":"first-line"}}"#,
    )
    .unwrap();
    install(&dir.0).unwrap();
    let mut value = settings(&dir.0);
    value["statusLine"]["command"] = "second-line".into();
    fs::write(dir.0.join("settings.json"), value.to_string()).unwrap();
    install(&dir.0).unwrap();
    let chain = fs::read_to_string(dir.0.join("hooks/cairngorm-statusline.chain")).unwrap();
    assert_eq!(chain, "second-line");
}

#[test]
fn float_times_are_read_and_missing_update_time_is_none() {
    let dir = TempDir::new();
    fs::write(
        dir.0.join(USAGE_FILE),
        r#"{"fiveHour":{"used_percentage":5,"resets_at":2000.0}}"#,
    )
    .unwrap();
    let (updated, windows) = read_usage(&dir.0, 1000).unwrap();
    assert_eq!(updated, None);
    assert_eq!(windows[0].resets_at, Some(2000));
}

/// Runs the installed relay the way Claude Code runs a status line command: through Git Bash
/// on Windows when present (else cmd), through `sh` elsewhere.
fn run_status_line(command: &str, input: &str) -> std::process::Output {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut shell = if cfg!(windows) {
        let bash = std::path::Path::new(r"C:\Program Files\Git\bin\bash.exe");
        if bash.is_file() {
            let mut shell = Command::new(bash);
            shell.arg("-c").arg(command);
            shell
        } else {
            let mut shell = Command::new("cmd");
            shell.arg("/C").arg(command);
            shell
        }
    } else {
        let mut shell = Command::new("sh");
        shell.arg("-c").arg(command);
        shell
    };
    let mut child = shell
        .env_remove("CAIRNGORM_STATUSLINE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

/// The break this catches: the relay script itself fails (syntax, encoding, Claude's input
/// shape, quoting of the installed command), so limits are never saved or the user's own
/// status line goes blank. Executes the real script; python3 is required off Windows.
#[test]
fn the_installed_relay_saves_limits_and_still_prints_the_previous_status_line() {
    if !cfg!(windows) && !crate::claude_statusline::python_available() {
        eprintln!("skipped: no python3, so Cairngorm does not install the relay here");
        return;
    }
    let dir = TempDir::new();
    fs::write(
        dir.0.join("settings.json"),
        r#"{"statusLine":{"type":"command","command":"echo previous-line-ok"}}"#,
    )
    .unwrap();
    install(&dir.0).unwrap();
    let command = settings(&dir.0)["statusLine"]["command"]
        .as_str()
        .unwrap()
        .to_string();
    // The shape Claude Code passes to status lines (recorded from Claude Code 2.x).
    let input = r#"{"session_id":"s1","model":{"id":"claude-opus","display_name":"Opus"},"workspace":{"current_dir":"C:/x"},"rate_limits":{"five_hour":{"used_percentage":62,"resets_at":1792978200},"seven_day":{"used_percentage":94.5,"resets_at":1793170800}}}"#;
    let output = run_status_line(&command, input);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("previous-line-ok"),
        "stdout: {stdout}; stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let (updated, windows) = read_usage(&dir.0, 1_792_900_000).expect("usage file written");
    assert!(updated.is_some());
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].used_percent, 62.0);
    assert_eq!(windows[0].resets_at, Some(1_792_978_200));
    assert_eq!(windows[1].used_percent, 94.5);

    // Input without limits (before Claude's first answer) leaves the saved file alone.
    let before = fs::read_to_string(dir.0.join(USAGE_FILE)).unwrap();
    let output = run_status_line(&command, r#"{"session_id":"s1"}"#);
    assert!(String::from_utf8_lossy(&output.stdout).contains("previous-line-ok"));
    assert_eq!(fs::read_to_string(dir.0.join(USAGE_FILE)).unwrap(), before);
}

/// The break this catches: an idle session redraws its status line (for /clear, /usage or a
/// mode change) with the limits it saw long ago and hides another session's newer reading.
#[test]
fn an_older_reading_from_another_session_does_not_replace_a_newer_one() {
    if !cfg!(windows) && !crate::claude_statusline::python_available() {
        eprintln!("skipped: no python3, so Cairngorm does not install the relay here");
        return;
    }
    let dir = TempDir::new();
    install(&dir.0).unwrap();
    let command = settings(&dir.0)["statusLine"]["command"]
        .as_str()
        .unwrap()
        .to_string();
    let send = |five: (f64, i64), seven: (f64, i64)| {
        let input = serde_json::json!({"rate_limits": {
            "five_hour": {"used_percentage": five.0, "resets_at": five.1},
            "seven_day": {"used_percentage": seven.0, "resets_at": seven.1},
        }});
        run_status_line(&command, &input.to_string());
    };
    let now = 1_792_900_000;
    let read = || {
        let (_, windows) = read_usage(&dir.0, now).expect("usage file written");
        (windows[0].used_percent, windows[1].used_percent)
    };
    let (window, week) = (1_792_978_200, 1_793_170_800);
    send((62.0, window), (45.0, week));

    // Same windows at a lower percentage: an older reading, so nothing changes.
    let before = fs::read_to_string(dir.0.join(USAGE_FILE)).unwrap();
    send((0.0, window + 60), (42.0, week));
    assert_eq!(fs::read_to_string(dir.0.join(USAGE_FILE)).unwrap(), before);

    // A window that ended before the saved one is older too.
    send((90.0, window - 5 * 3600), (45.0, week));
    assert_eq!(read(), (62.0, 45.0));

    // A higher percentage in one window is taken; the other keeps the saved value.
    send((70.0, window), (40.0, week));
    assert_eq!(read(), (70.0, 45.0));

    // A new 5-hour window starts again from a low percentage.
    send((3.0, window + 5 * 3600), (46.0, week));
    assert_eq!(read(), (3.0, 46.0));

    // A damaged file never blocks a new reading.
    fs::write(dir.0.join(USAGE_FILE), "{ not json").unwrap();
    send((5.0, window), (1.0, week));
    assert_eq!(read(), (5.0, 1.0));

    // A saved reading over an hour old gives way even to an earlier reset time, so a
    // corrected or wrong window can never hold the display.
    let old = serde_json::json!({
        "updatedAt": 1_000,
        "fiveHour": {"used_percentage": 80, "resets_at": window},
        "sevenDay": {"used_percentage": 50, "resets_at": week},
    });
    fs::write(dir.0.join(USAGE_FILE), old.to_string()).unwrap();
    send((4.0, window - 5 * 3600), (10.0, week));
    assert_eq!(read(), (4.0, 10.0));
    let leftovers = fs::read_dir(&dir.0)
        .unwrap()
        .filter(|entry| {
            entry
                .as_ref()
                .unwrap()
                .path()
                .to_string_lossy()
                .ends_with(".tmp")
        })
        .count();
    assert_eq!(leftovers, 0);
}
