use super::profile_tests::profile_args;
use super::*;

fn pi_report(path: &Path) -> Report {
    Report {
        agent: "pi".into(),
        id: "pi-current-session".into(),
        path: Some(path.to_string_lossy().into_owned()),
        cwd: None,
        permission_mode: None,
        flags: vec!["--no-tools".into()],
    }
}

#[test]
fn latest_pi_sessions_replace_historical_claude_launches() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../logs/native/restore-state")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    let (shell, args) = profile_args("C:/bin/claude.exe", &["--dangerously-skip-permissions"]);
    for i in 0..3 {
        let path = dir.join(format!("pi-{i}.jsonl"));
        std::fs::write(&path, "{}\n").unwrap();
        let mut report = pi_report(&path);
        report.id = format!("pi-session-{i}");
        assert!(restores(&shell, &args, &report));
        let cmd = build_command(&shell, args.clone(), None, Some(&report));
        let command = cmd.get_argv().last().unwrap().to_str().unwrap();
        assert!(command.starts_with("pi --session "), "{command}");
        assert!(command.ends_with(" --no-tools"));
        assert!(!command.contains("claude"));
        assert!(!command.contains("skip-permissions"));
        assert!(claim(&report, &format!("pane-{i}")));
        assert!(!claim(&report, &format!("duplicate-{i}")));
        release(&format!("pane-{i}"));
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn closed_agent_and_missing_pi_transcript_never_replay_old_claude() {
    let (shell, args) = profile_args("C:/bin/claude.exe", &[]);
    let missing = std::env::temp_dir().join(format!("missing-pi-{}.jsonl", uuid::Uuid::new_v4()));
    for report in [
        Report {
            agent: "shell".into(),
            ..pi_report(&missing)
        },
        pi_report(&missing),
    ] {
        let cmd = build_command(&shell, args.clone(), None, Some(&report));
        let argv: Vec<_> = cmd.get_argv().iter().map(|v| v.to_string_lossy()).collect();
        assert_eq!(argv, [shell.as_str(), "-NoLogo", "-NoExit"]);
        assert!(!restores(&shell, &args, &report));
    }
}

#[test]
fn explicit_user_commands_are_not_rewritten_as_agent_profiles() {
    let report = Report {
        agent: "shell".into(),
        ..pi_report(Path::new("/missing/pi.jsonl"))
    };
    for args in [
        vec!["-Command".into(), "Write-Output 'user script'".into()],
        vec!["-File".into(), "custom.ps1".into()],
    ] {
        let cmd = build_command("powershell.exe", args.clone(), None, Some(&report));
        assert_eq!(
            cmd.get_argv()[1..],
            args.iter()
                .map(std::ffi::OsString::from)
                .collect::<Vec<_>>()
        );
    }
    // Even a valid profile payload embedded in another user script is not our wrapper.
    use base64::{engine::general_purpose::STANDARD, Engine};
    let (shell, mut explicit) = profile_args("C:/bin/claude.exe", &[]);
    let bytes = STANDARD.decode(&explicit[3]).unwrap();
    let units: Vec<_> = bytes
        .chunks_exact(2)
        .map(|p| u16::from_le_bytes([p[0], p[1]]))
        .collect();
    let script = format!(
        "{}\nWrite-Output 'custom side effect'",
        String::from_utf16(&units).unwrap()
    );
    explicit[3] = STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let cmd = build_command(&shell, explicit.clone(), None, Some(&report));
    assert_eq!(
        cmd.get_argv()[1..],
        explicit
            .iter()
            .map(std::ffi::OsString::from)
            .collect::<Vec<_>>()
    );
    let (shell, args) = profile_args("C:/bin/claude.exe", &[]);
    let cmd = build_command(&shell, args.clone(), None, None);
    assert_eq!(
        cmd.get_argv()[1..],
        args.iter()
            .map(std::ffi::OsString::from)
            .collect::<Vec<_>>(),
        "an explicit new launch still runs the selected CLI"
    );
}

#[test]
fn latest_permission_mode_replaces_historical_bypass_flags() {
    let (shell, args) = profile_args("C:/bin/claude.exe", &["--dangerously-skip-permissions"]);
    let mut report = pi_report(Path::new("/unused"));
    report.agent = "claude".into();
    report.path = None; // Legacy Claude reports did not include a transcript path.
    report.permission_mode = Some("plan".into());
    let cmd = build_command(&shell, args, None, Some(&report));
    let argv: Vec<_> = cmd
        .get_argv()
        .iter()
        .skip(1)
        .map(|v| v.to_string_lossy().into_owned())
        .collect();
    let cli = crate::launch_profiles::profile_cli(&shell, &argv).unwrap();
    assert_eq!(
        cli.args,
        [
            "--resume",
            "pi-current-session",
            "--permission-mode",
            "plan"
        ]
    );
}

#[test]
fn a_closed_direct_agent_returns_to_a_shell_instead_of_relaunching() {
    let report = Report {
        agent: "shell".into(),
        ..pi_report(Path::new("/missing/pi.jsonl"))
    };
    for executable in ["claude.exe", "amp.exe"] {
        let cmd = build_command(executable, vec![], None, Some(&report));
        assert_ne!(cmd.get_argv()[0], executable);
    }
    let (shell, args) = profile_args("C:/bin/amp.exe", &[]);
    let cmd = build_command(&shell, args, None, Some(&report));
    assert_eq!(
        cmd.get_argv().len(),
        3,
        "an exited catalog CLI returns to its hosting shell"
    );
}
