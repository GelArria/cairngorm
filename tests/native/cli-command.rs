//! The `cairngorm` command as a user runs it: real process, exit codes, output, and the
//! request it forwards to the app (a stand-in that records what it was started with).
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_cairngorm-cli");

fn echo_app() -> PathBuf {
    let dir = Path::new(BIN).parent().unwrap().join("examples");
    dir.join(format!("cli-echo-app{}", std::env::consts::EXE_SUFFIX))
}

fn scratch() -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("cairngorm-cli-{}-{n}", std::process::id()));
    std::fs::create_dir_all(dir.join("my project")).unwrap();
    std::fs::write(dir.join("my project").join("notes.md"), "notes").unwrap();
    // The command sees its folder as the system reports it: macOS temp folders are links
    // (/var → /private/var). Windows keeps the plain path (canonical would be \\?\…).
    #[cfg(unix)]
    let dir = std::fs::canonicalize(&dir).unwrap();
    dir
}

fn run(args: &[&str], cwd: &Path, record: Option<&Path>) -> Output {
    let mut command = Command::new(BIN);
    command.args(args).current_dir(cwd);
    match record {
        Some(out) => command
            .env("CAIRNGORM_APP", echo_app())
            .env("CAIRNGORM_ECHO_OUT", out),
        // Nothing may be started: point at a program that does not exist.
        None => command.env("CAIRNGORM_APP", cwd.join("no-such-app")),
    };
    command.output().unwrap()
}

/// The app is started detached, so its record appears shortly after the command exits.
fn recorded(out: &Path) -> Vec<String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !out.exists() {
        assert!(Instant::now() < deadline, "the app was never started");
        std::thread::sleep(Duration::from_millis(25));
    }
    std::fs::read_to_string(out)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace("\r\n", "\n")
}

fn app_version() -> String {
    let config = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../src-tauri/tauri.conf.json");
    let config: String = std::fs::read_to_string(config).unwrap();
    let start = config.find("\"version\": \"").unwrap() + "\"version\": \"".len();
    config[start..].split('"').next().unwrap().to_string()
}

fn same_folder(a: &str, b: &Path) -> bool {
    std::fs::canonicalize(a).unwrap() == std::fs::canonicalize(b).unwrap()
}

#[test]
fn version_and_help_print_without_starting_the_app() {
    let dir = scratch();
    let version = run(&["--version"], &dir, None);
    assert!(version.status.success());
    assert_eq!(
        text(&version.stdout),
        format!("cairngorm {}\n", app_version())
    );

    let help = run(&["-h"], &dir, None);
    assert!(help.status.success());
    let help = text(&help.stdout);
    assert!(help.starts_with(&format!("Cairngorm {}\n", app_version())));
    assert!(help.contains("Usage: cairngorm [path] [options]"));
    assert!(help.contains("--agent <cli>"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn mistakes_fail_with_a_message_and_start_nothing() {
    let dir = scratch();
    let usage = run(&["--bogus"], &dir, None);
    assert_eq!(usage.status.code(), Some(2));
    assert!(text(&usage.stderr).contains("Unknown option '--bogus'"));
    assert!(text(&usage.stdout).is_empty());

    let agent = run(&["-a", "rm -rf"], &dir, None);
    assert_eq!(agent.status.code(), Some(2));

    let missing = run(&["missing-folder"], &dir, None);
    assert_eq!(missing.status.code(), Some(1));
    assert!(text(&missing.stderr).contains("No such file or folder: missing-folder"));

    // A valid request whose app cannot start reports it.
    let no_app = run(&["."], &dir, None);
    assert_eq!(no_app.status.code(), Some(1));
    assert!(text(&no_app.stderr).contains("Cannot start Cairngorm"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_request_reaches_the_app_with_absolute_paths() {
    let dir = scratch();
    let out = dir.join("record.txt");
    let project = std::path::absolute(dir.join("my project")).unwrap();
    let result = run(
        &["my project", "-a", "claude", "--git", "-t"],
        &dir,
        Some(&out),
    );
    assert!(result.status.success(), "{}", text(&result.stderr));
    assert_eq!(
        text(&result.stdout),
        format!("Opening {} in Cairngorm\n", project.display())
    );
    let lines = recorded(&out);
    assert!(same_folder(&lines[0], &dir), "started in {}", lines[0]);
    assert_eq!(
        lines[1..],
        [
            "--terminal".to_string(),
            "--agent=claude".into(),
            "--git".into(),
            "--".into(),
            project.display().to_string(),
        ]
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn files_terminals_and_a_bare_launch_are_forwarded() {
    let dir = scratch();
    let project = dir.join("my project");

    let file = project.join("file.txt");
    let notes = std::path::absolute(project.join("notes.md")).unwrap();
    assert!(run(&["notes.md"], &project, Some(&file)).status.success());
    assert_eq!(
        recorded(&file)[1..],
        ["--".to_string(), notes.display().to_string()]
    );

    // A terminal without a path opens where the command ran.
    let here = project.join("here.txt");
    assert!(run(&["-t"], &project, Some(&here)).status.success());
    let lines = recorded(&here);
    assert_eq!(lines[1], "--terminal");
    assert!(same_folder(&lines[3], &project));

    let bare = dir.join("bare.txt");
    let result = run(&[], &dir, Some(&bare));
    assert_eq!(text(&result.stdout), "Bringing Cairngorm to the front\n");
    assert_eq!(recorded(&bare).len(), 1, "no arguments are forwarded");

    let settings = dir.join("settings.txt");
    assert!(run(&["--settings=providers"], &dir, Some(&settings))
        .status
        .success());
    assert_eq!(
        recorded(&settings)[1..],
        ["--settings=providers".to_string()]
    );
    std::fs::remove_dir_all(dir).unwrap();
}
