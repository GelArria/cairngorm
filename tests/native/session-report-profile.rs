use super::*;

#[test]
fn explicit_profile_launch_is_not_combined_with_a_conversation_resume() {
    let dir = std::env::temp_dir().join(format!(
        "Restore Profile With Spaces {}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&dir).unwrap();
    let script = dir.join("argv echo.js");
    std::fs::write(
        &script,
        "console.log(JSON.stringify(process.argv.slice(2)))",
    )
    .unwrap();
    let report = Report {
        agent: "claude".into(),
        id: "scratch-session".into(),
        permission_mode: Some("bypassPermissions".into()),
        path: None,
        cwd: None,
        flags: vec![],
    };
    let expected = vec!["one argument".to_string(), "".into(), "literal; & Ω".into()];
    let hosts: &[&str] = if cfg!(windows) {
        &["powershell.exe", "pwsh.exe"]
    } else {
        &["bash", "sh"]
    };
    let mut tested = 0;
    for host in hosts {
        let Ok(host) = which::which(host) else {
            continue;
        };
        let launch = crate::launch_profiles::resolve(crate::launch_profiles::LaunchProfile {
            id: "fixture".into(),
            name: "Echo".into(),
            program: script.to_string_lossy().into_owned(),
            args: expected.clone(),
            shell: Some(crate::launch_profiles::ShellHost {
                path: host.to_string_lossy().into_owned(),
                args: vec![],
            }),
        })
        .unwrap();
        let restored = build_command(
            &launch.shell_path,
            launch.shell_args.clone(),
            Some(dir.to_string_lossy().into_owned()),
            Some(&report),
        );
        let argv: Vec<_> = restored
            .get_argv()
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(&argv[1..], launch.shell_args);
        // Interactive host retention is unrelated to argv transport; exit after the echo in this fixture.
        let mut command = crate::ai_cli::command(std::path::Path::new(&launch.shell_path)).unwrap();
        command.args(argv.iter().skip(1).filter(|arg| arg.as_str() != "-NoExit"));
        let (ok, out, err) =
            crate::ai_cli::run(command, None, std::time::Duration::from_secs(30)).unwrap();
        assert!(ok, "{err}");
        assert_eq!(
            serde_json::from_str::<Vec<String>>(out.trim()).unwrap(),
            expected
        );
        tested += 1;
    }
    assert!(
        tested > 0,
        "No supported shell available for the restoration fixture"
    );
    std::fs::remove_dir_all(dir).unwrap();
}

fn claude_report(mode: Option<&str>) -> Report {
    Report {
        agent: "claude".into(),
        id: "b4e09d26-eec9-4840-8884-498ec7857292".into(),
        permission_mode: mode.map(Into::into),
        path: None,
        cwd: None,
        flags: vec![],
    }
}

fn restored_cli(shell: &str, args: Vec<String>, report: &Report) -> (Vec<String>, Vec<String>) {
    let cmd = build_command(shell, args, None, Some(report));
    let argv: Vec<String> = cmd
        .get_argv()
        .iter()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let cli = crate::launch_profiles::profile_cli(shell, &argv).unwrap();
    (argv, cli.args)
}

/// A persisted PowerShell profile tab, encoded like launch-cli.ps1 without an installed CLI.
pub(super) fn profile_args(program: &str, args: &[&str]) -> (String, Vec<String>) {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let payload = STANDARD.encode(
        serde_json::to_vec(&serde_json::json!({"program": program, "args": args})).unwrap(),
    );
    let script =
        include_str!("../../src/terminal/assets/launch-cli.ps1").replace("__PAYLOAD__", &payload);
    let encoded = STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<u8>>(),
    );
    let shell = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe".to_string();
    (
        shell,
        vec![
            "-NoLogo".into(),
            "-NoExit".into(),
            "-EncodedCommand".into(),
            encoded,
        ],
    )
}

#[test]
fn claude_profile_tabs_resume_their_conversation_and_permission_mode() {
    let report = claude_report(Some("bypassPermissions"));
    let (shell, args) = profile_args("C:/Users/me/.local/bin/claude.exe", &["--model", "opus"]);
    let (argv, cli) = restored_cli(&shell, args, &report);
    assert_eq!(&argv[..3], ["-NoLogo", "-NoExit", "-EncodedCommand"]);
    assert_eq!(
        cli,
        [
            "--resume",
            "b4e09d26-eec9-4840-8884-498ec7857292",
            "--dangerously-skip-permissions"
        ]
    );

    let (_, cli) = restored_cli(
        "C:/Users/me/.local/bin/claude.exe",
        vec![],
        &claude_report(Some("auto")),
    );
    assert_eq!(
        cli,
        [
            "--resume",
            "b4e09d26-eec9-4840-8884-498ec7857292",
            "--permission-mode",
            "auto"
        ]
    );

    let script = "program=$1; shift; trap : INT; \"$program\" \"$@\"; trap - INT; exec \"$0\"";
    let bash = vec![
        "-c".into(),
        script.into(),
        "/bin/bash".into(),
        "/usr/local/bin/claude".into(),
    ];
    let (argv, cli) = restored_cli("/bin/bash", bash, &claude_report(None));
    assert_eq!(argv[3], "/usr/local/bin/claude");
    assert_eq!(cli, ["--resume", "b4e09d26-eec9-4840-8884-498ec7857292"]);
}

#[test]
fn reported_sessions_replace_historical_session_choices_prompts_and_modes() {
    let report = claude_report(Some("bypassPermissions"));
    for (program, args) in [
        ("C:/bin/claude.exe", vec!["--continue"]),
        ("C:/bin/claude.exe", vec!["--resume=abc"]),
        // Prompts, print mode and subcommands must not be replayed into the conversation.
        ("C:/bin/claude.exe", vec!["fix the failing tests"]),
        ("C:/bin/claude.exe", vec!["--model", "opus", "summarize"]),
        ("C:/bin/claude.exe", vec!["-p", "summarize"]),
        ("C:/bin/claude.exe", vec!["mcp", "list"]),
        ("C:/bin/claude.exe", vec!["--", "prompt"]),
    ] {
        let (shell, original) = profile_args(program, &args);
        let (_, cli) = restored_cli(&shell, original, &report);
        assert_eq!(
            cli,
            [
                "--resume",
                "b4e09d26-eec9-4840-8884-498ec7857292",
                "--dangerously-skip-permissions"
            ],
            "{program} {args:?}"
        );
    }
    // The reported current mode wins over the mode used when the tab was first opened.
    let (shell, args) = profile_args("C:/bin/claude.exe", &["--permission-mode", "plan"]);
    let (_, cli) = restored_cli(&shell, args, &report);
    assert_eq!(
        cli,
        [
            "--resume",
            "b4e09d26-eec9-4840-8884-498ec7857292",
            "--dangerously-skip-permissions"
        ]
    );
}

#[test]
fn report_ids_cannot_become_cli_flags() {
    let mut report = claude_report(None);
    report.id = "--dangerously-skip-permissions".into();
    let (shell, args) = profile_args("C:/bin/claude.exe", &["--permission-mode", "plan"]);
    let cmd = build_command(&shell, args.clone(), None, Some(&report));
    let argv: Vec<String> = cmd
        .get_argv()
        .iter()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    assert_eq!(argv, args);
    assert!(resume(&report, true).is_none());
}
