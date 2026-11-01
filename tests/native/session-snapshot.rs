use super::*;

fn node(parent: Option<u32>, started: u64, agent: Option<&'static str>) -> Process {
    Process {
        parent,
        started,
        agent,
        headless: false,
        unknown_program: false,
    }
}

#[test]
fn shell_agent_exit_and_nested_agents_have_distinct_snapshots() {
    let mut processes = HashMap::from([
        (1, node(None, 10, None)),
        (2, node(Some(1), 11, Some("pi"))),
        (3, node(Some(2), 12, Some("claude"))),
    ]);
    assert_eq!(pane_agent(1, &processes), Some("pi"));
    assert_eq!(
        pane_agent(2, &processes),
        Some("pi"),
        "direct agent roots count too"
    );
    processes.remove(&2);
    assert_eq!(
        pane_agent(1, &processes),
        None,
        "an orphan tool is not the pane agent"
    );
    processes.insert(2, node(Some(1), 11, None));
    processes.insert(3, node(Some(2), 12, Some("pi")));
    assert_eq!(
        pane_agent(1, &processes),
        Some("pi"),
        "a shell wrapper is allowed"
    );
    processes.get_mut(&1).unwrap().started = 20;
    assert_eq!(
        pane_agent(1, &processes),
        None,
        "a reused parent PID is not ancestry"
    );
}

#[test]
fn headless_and_nested_children_cannot_keep_a_closed_interactive_agent_alive() {
    let mut processes = HashMap::from([
        (1, node(None, 1, None)),
        (2, node(Some(1), 2, Some("pi"))),
        (3, node(Some(2), 3, Some("claude"))),
    ]);
    processes.get_mut(&2).unwrap().headless = true;
    assert_eq!(pane_agent(1, &processes), None);
    assert_eq!(pane_agent(2, &processes), None);
    assert_eq!(pane_state(1, &processes), PaneState::Shell);
    assert_eq!(pane_state(2, &processes), PaneState::Shell);
}

#[test]
fn closing_the_app_preserves_live_reports_but_marks_exited_agents_as_shells() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../logs/native/restore-state")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    for i in 0..3 {
        let file = dir.join(format!("pane-{i}.json"));
        let report =
            serde_json::json!({ "agent": "pi", "id": format!("pi-{i}"), "cwd": "C:/repo" })
                .to_string();
        std::fs::write(&file, &report).unwrap();
        record(&file, PaneState::Agent("pi")).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), report);
        assert!(
            record(&file, PaneState::Agent("claude")).is_err(),
            "never pair a foreign agent with a Pi id"
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), report);
        record(&file, PaneState::Shell).unwrap();
        let closed: super::super::Report =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(closed.agent, "shell");
        assert_eq!(closed.cwd.as_deref(), Some("C:/repo"));
    }
    let file = dir.join("no-agent-ever.json");
    record(&file, PaneState::Shell).unwrap();
    assert!(std::fs::read_to_string(file).unwrap().contains("shell"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn real_process_snapshot_recognizes_a_fixture_agent_and_its_exit() {
    use std::process::{Command, Stdio};
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../logs/native/restore-state")
        .join(uuid::Uuid::new_v4().to_string())
        .join("node_modules/@earendil-works/pi-coding-agent");
    std::fs::create_dir_all(&dir).unwrap();
    let script = dir.join("fixture.mjs");
    std::fs::write(&script, "setInterval(() => {}, 1000)").unwrap();
    let mut child = Command::new("node")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let pid = child.id();
    let mut found = None;
    for _ in 0..50 {
        found = pane_agent(pid, &process_tree());
        if found.is_some() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    // Only the disposable fixture process is stopped, never Cairngorm or an agent CLI.
    let killed = child.kill();
    let waited = child.wait();
    let after = pane_agent(pid, &process_tree());
    std::fs::remove_dir_all(dir.ancestors().nth(3).unwrap()).unwrap();
    assert!(killed.is_ok());
    assert!(waited.is_ok());
    assert_eq!(found, Some("pi"));
    assert_eq!(after, None);
}

#[test]
fn unknown_programs_and_unsupported_agents_are_not_confirmed_shells() {
    let mut processes = HashMap::from([(1, node(None, 1, None)), (2, node(Some(1), 2, None))]);
    processes.get_mut(&2).unwrap().unknown_program = true;
    assert_eq!(pane_state(1, &processes), PaneState::Unreported);
    processes.get_mut(&2).unwrap().agent = Some("amp");
    assert_eq!(pane_state(1, &processes), PaneState::Unreported);
    processes.remove(&2);
    assert_eq!(pane_state(1, &processes), PaneState::Shell);
}

#[test]
fn headless_command_classification_matches_the_session_bridges() {
    for (agent, args, expected) in [
        ("codex", vec!["codex", "exec", "do it"], true),
        ("codex", vec!["codex", "resume", "session-id"], false),
        ("claude", vec!["claude", "--prompt", "do it"], true),
        ("claude", vec!["claude", "--prompt=do it"], true),
        ("pi", vec!["pi", "--mode", "json"], true),
        ("pi", vec!["pi", "--mode=rpc"], true),
        ("pi", vec!["pi", "--session", "saved.jsonl"], false),
    ] {
        let args = args.into_iter().map(String::from).collect::<Vec<_>>();
        assert_eq!(headless(Some(agent), &args), expected, "{args:?}");
    }
    let unknown_args = vec!["custom".to_string(), "--prompt".into()];
    assert!(!headless(None, &unknown_args));
    assert!(!headless(Some("amp"), &unknown_args));
}

#[test]
fn unsupported_agents_replace_absent_shell_and_foreign_reports_without_blocking_close() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../logs/native/restore-state")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("pane.json");
    for previous in [
        None,
        Some(r#"{"agent":"shell","id":"shell"}"#),
        Some(r#"{"agent":"pi","id":"old-pi"}"#),
    ] {
        if let Some(previous) = previous {
            std::fs::write(&file, previous).unwrap();
        } else {
            let _ = std::fs::remove_file(&file);
        }
        record(&file, PaneState::Unreported).unwrap();
        let report: super::super::Report =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(report.agent, "unreported");
        for program in ["C:/bin/aider.exe", "C:/bin/amp.exe", "C:/bin/custom.exe"] {
            let (shell, args) = super::super::profile_tests::profile_args(program, &[]);
            let cmd = super::super::build_command(&shell, args, None, Some(&report));
            let args = cmd
                .get_argv()
                .iter()
                .skip(1)
                .map(|v| v.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            assert_eq!(
                crate::launch_profiles::profile_cli(&shell, &args)
                    .unwrap()
                    .program,
                program
            );
        }
        let (shell, args) = super::super::profile_tests::profile_args("C:/bin/claude.exe", &[]);
        let cmd = super::super::build_command(&shell, args, None, Some(&report));
        assert_eq!(
            cmd.get_argv().len(),
            3,
            "never replay a known foreign agent for an unsupported process"
        );
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_confirmed_shell_replaces_corrupt_and_oversized_old_metadata() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../logs/native/restore-state")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("pane.json");
    for previous in ["not-json".to_string(), "x".repeat(8193)] {
        std::fs::write(&file, previous).unwrap();
        assert!(record(&file, PaneState::Agent("pi")).is_err());
        record(&file, PaneState::Shell).unwrap();
        assert_eq!(read_report(&file).unwrap().unwrap().agent, "shell");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn process_identity_names_the_cli_not_the_model() {
    for (name, exe, args, expected) in [
        (
            "node.exe",
            "C:/node.exe",
            vec![
                "node.exe",
                "C:/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
                "--model",
                "claude",
            ],
            Some("pi"),
        ),
        (
            "node",
            "/usr/bin/node",
            vec!["node", "/pkg/node_modules/@xai-official/grok/cli.js"],
            Some("grok"),
        ),
        (
            "powershell.exe",
            "C:/powershell.exe",
            vec!["powershell.exe", "-Command", "echo claude"],
            None,
        ),
    ] {
        let args = args.into_iter().map(String::from).collect::<Vec<_>>();
        assert_eq!(crate::plugins::agent_of_process(name, exe, &args), expected);
    }
}

#[test]
fn busy_panes_ignores_empty_and_exited_roots() {
    assert_eq!(busy_panes(&[]), 0);
    // No process has this id, so an exited terminal never keeps the app running.
    assert_eq!(busy_panes(&[u32::MAX - 1]), 0);
}
