use super::*;

#[test]
fn claude_resume_restores_only_explicitly_reported_permission_modes() {
    for (mode, expected) in [
        ("bypassPermissions", " --dangerously-skip-permissions"),
        ("acceptEdits", " --permission-mode acceptEdits"),
        ("plan", " --permission-mode plan"),
        ("default", " --permission-mode default"),
        ("manual", " --permission-mode manual"),
        ("dontAsk", " --permission-mode dontAsk"),
        ("auto", " --permission-mode auto"),
        ("unknown", ""),
        ("bypassPermissions; whoami", ""),
    ] {
        let report = serde_json::from_value::<Report>(serde_json::json!({
            "agent": "claude", "id": "uuid-123", "permission_mode": mode
        }))
        .unwrap();
        for host in ["pwsh.exe", "bash", "cmd.exe"] {
            let cmd = build_command(host, vec![], None, Some(&report));
            let id = if host == "cmd.exe" {
                "uuid-123"
            } else {
                "'uuid-123'"
            };
            let restart = if host == "bash" { "; exec 'bash'" } else { "" };
            assert_eq!(
                cmd.get_argv().last().unwrap().to_str().unwrap(),
                format!("claude --resume {id}{expected}{restart}"),
                "{host}",
            );
        }
    }
}

#[test]
fn legacy_reports_and_other_agents_never_gain_claude_permissions() {
    for (agent, flag) in [
        ("claude", "--resume"),
        ("droid", "--resume"),
        ("opencode", "--session"),
    ] {
        let mut value = serde_json::json!({ "agent": agent, "id": "legacy-session" });
        if agent != "claude" {
            value["permission_mode"] = serde_json::json!("bypassPermissions");
        }
        let report = serde_json::from_value::<Report>(value).unwrap();
        assert_eq!(
            resume(&report, true).unwrap(),
            format!("{agent} {flag} 'legacy-session'")
        );
    }
}

#[test]
fn closing_or_failed_launch_releases_resume_ownership() {
    let report = Report {
        agent: "droid".into(),
        id: "dedupe-test-uuid".into(),
        permission_mode: None,
        path: None,
        cwd: None,
        flags: vec![],
    };
    assert!(claim(&report, "pane-one"));
    assert!(!claim(&report, "pane-two"));
    release("pane-one");
    assert!(claim(&report, "pane-two"));
    release("pane-two");
}
#[test]
fn native_refs_are_not_terminal_ids_and_commands_cannot_be_injected() {
    for (agent, flag) in [
        ("opencode", "--session"),
        ("droid", "--resume"),
        ("claude", "--resume"),
    ] {
        let r = Report {
            agent: agent.into(),
            id: "uuid-123".into(),
            permission_mode: None,
            path: None,
            cwd: None,
            flags: vec![],
        };
        let cmd = build_command("pwsh.exe", vec![], None, Some(&r));
        assert_eq!(
            cmd.get_argv().last().unwrap().to_str().unwrap(),
            format!("{agent} {flag} 'uuid-123'")
        );
    }
    for bad in [";rm -rf /", "$(whoami)", "..", "a\nb", "x'&whoami", ""] {
        assert!(resume(
            &Report {
                agent: "droid".into(),
                id: bad.into(),
                permission_mode: None,
                path: None,
                cwd: None,
                flags: vec![],
            },
            true
        )
        .is_none());
        assert!(!valid_id(bad));
    }
    assert!(resume(
        &Report {
            agent: "unknown".into(),
            id: "ok".into(),
            permission_mode: None,
            path: None,
            cwd: None,
            flags: vec![],
        },
        true
    )
    .is_none());
    assert!(resume(
        &Report {
            agent: "pi".into(),
            id: "ok".into(),
            permission_mode: None,
            path: Some("/missing/session.jsonl".into()),
            cwd: None,
            flags: vec![],
        },
        true
    )
    .is_none());
    assert_eq!(
        quote("C:/it's work/a.jsonl", true),
        "'C:/it''s work/a.jsonl'"
    );
    assert_eq!(quote("it's", false), "'it'\\''s'");
}

#[test]
fn hook_agents_resume_with_their_own_commands() {
    for (agent, mode, expected) in [
        ("codex", "default", "codex resume 'uuid-123'"),
        (
            "codex",
            "bypassPermissions",
            "codex resume 'uuid-123' --dangerously-bypass-approvals-and-sandbox",
        ),
        ("gemini", "bypassPermissions", "gemini --resume 'uuid-123'"),
        ("qwen", "", "qwen --resume 'uuid-123'"),
        ("copilot", "", "copilot --session-id 'uuid-123'"),
        ("cursor", "", "cursor-agent --resume 'uuid-123'"),
        ("grok", "", "grok --resume 'uuid-123'"),
    ] {
        let report = serde_json::from_value::<Report>(serde_json::json!({
            "agent": agent, "id": "uuid-123", "permission_mode": mode
        }))
        .unwrap();
        assert_eq!(resume(&report, true).unwrap(), expected, "{agent}");
    }
}

/// The break: Cairngorm closes while a Claude or Pi pane was opened but never used. The agent
/// never saved that conversation, so `--resume` fails ("No conversation found") and the pane
/// shows an error. Such a pane must start the agent again the way it was launched.
#[test]
fn an_agent_opened_but_never_used_starts_again_instead_of_resuming() {
    let dir = std::env::temp_dir().join(format!("cairngorm-unsaved-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let missing = dir.join("never-saved.jsonl");
    let Some(host) = [if cfg!(windows) {
        "powershell.exe"
    } else {
        "bash"
    }]
    .into_iter()
    .find_map(|host| which::which(host).ok()) else {
        return;
    };
    for agent in ["claude", "pi"] {
        // A profile that launches the agent with a launch mode, through the usual host shell.
        let program = dir.join(if cfg!(windows) {
            format!("{agent}.exe")
        } else {
            agent.to_string()
        });
        #[cfg(windows)]
        std::fs::copy(r"C:\Windows\System32\whoami.exe", &program).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::write(&program, "#!/bin/sh\n").unwrap();
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let launch = crate::launch_profiles::resolve(crate::launch_profiles::LaunchProfile {
            id: "fixture".into(),
            name: agent.into(),
            program: program.to_string_lossy().into_owned(),
            args: vec!["--dangerously-skip-permissions".into()],
            shell: Some(crate::launch_profiles::ShellHost {
                path: host.to_string_lossy().into_owned(),
                args: vec![],
            }),
        })
        .unwrap();
        let report = serde_json::from_value::<Report>(serde_json::json!({
            "agent": agent, "id": "uuid-123", "path": missing.to_string_lossy(),
            "permission_mode": "bypassPermissions"
        }))
        .unwrap();
        assert!(resume(&report, true).is_none(), "{agent}");
        let cmd = build_command(
            &launch.shell_path,
            launch.shell_args.clone(),
            None,
            Some(&report),
        );
        let argv: Vec<String> = cmd
            .get_argv()
            .iter()
            .map(|a| a.to_string_lossy().into())
            .collect();
        assert_eq!(argv[1..], launch.shell_args[..], "{agent}");
    }
    // Once the conversation is saved, the same report resumes it.
    std::fs::write(&missing, "{}").unwrap();
    let saved = serde_json::from_value::<Report>(serde_json::json!({
        "agent": "claude", "id": "uuid-123", "path": missing.to_string_lossy()
    }))
    .unwrap();
    assert_eq!(resume(&saved, true).unwrap(), "claude --resume 'uuid-123'");
    let _ = std::fs::remove_dir_all(&dir);
}
