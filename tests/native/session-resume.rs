use super::*;

fn report(agent: &str, mode: Option<&str>, flags: &[&str]) -> Report {
    serde_json::from_value(serde_json::json!({
        "agent": agent, "id": "uuid-123", "permission_mode": mode, "flags": flags
    }))
    .unwrap()
}

#[test]
fn launch_state_is_restored_for_each_agent() {
    for (report, expected) in [
        (
            report("grok", Some("bypassPermissions"), &[]),
            "grok --resume 'uuid-123' --permission-mode bypassPermissions",
        ),
        (
            report("grok", Some("auto"), &[]),
            "grok --resume 'uuid-123' --permission-mode auto",
        ),
        (
            report("cursor", None, &["--yolo", "--plan", "--sandbox=disabled"]),
            "cursor-agent --resume 'uuid-123' --force --mode plan --sandbox disabled",
        ),
        (
            report("cursor", None, &["-f", "--mode", "ask"]),
            "cursor-agent --resume 'uuid-123' --force --mode ask",
        ),
        (
            report("gemini", None, &["--approval-mode", "auto_edit"]),
            "gemini --resume 'uuid-123' --approval-mode auto_edit",
        ),
        (
            report("qwen", None, &["-y"]),
            "qwen --resume 'uuid-123' --yolo",
        ),
    ] {
        assert_eq!(resume(&report, true).unwrap(), expected);
    }
}

#[test]
fn pi_keeps_its_restrictive_flags_and_quotes_tool_lists() {
    let dir = std::env::temp_dir().join(format!("cairngorm-pi-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("session.jsonl");
    std::fs::write(&path, "{}").unwrap();
    let report: Report = serde_json::from_value(serde_json::json!({
        "agent": "pi", "id": "uuid-123", "path": path,
        "flags": ["-t", "read,grep,mcp__*", "--no-mcp", "--plan", "--approve"]
    }))
    .unwrap();
    let command = resume(&report, true).unwrap();
    assert!(
        command.ends_with(" --tools 'read,grep,mcp__*' --no-mcp --plan"),
        "{command}"
    );
    for flags in [vec!["--tools", "--no-tools"], vec!["--tools", "read grep"]] {
        let mut bad: Report = serde_json::from_value(
            serde_json::json!({"agent": "pi", "id": "uuid-123", "path": path}),
        )
        .unwrap();
        bad.flags = flags.iter().map(|s| s.to_string()).collect();
        // A tool restriction that cannot be kept must not reopen Pi with every tool.
        assert!(resume_args(&bad).is_none(), "{flags:?}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn reported_flags_cannot_inject_arguments_or_other_agents_options() {
    for (agent, flags) in [
        ("cursor", vec!["--sandbox", "disabled; rm -rf /"]),
        ("cursor", vec!["--mode", "--force"]),
        ("cursor", vec!["--dangerously-skip-permissions"]),
        ("claude", vec!["--yolo"]),
        ("gemini", vec!["--approval-mode=everything"]),
        ("grok", vec!["--always-approve"]),
    ] {
        let r = report(agent, None, &flags);
        let (_, groups) = resume_args(&r).unwrap();
        assert_eq!(groups.len(), 1, "{agent} {flags:?} -> {groups:?}");
    }
    let r = report("grok", Some("anything"), &[]);
    assert_eq!(resume_args(&r).unwrap().1.len(), 1);
}

#[test]
fn disabled_switches_and_repeated_flags_follow_the_cli() {
    assert_eq!(
        resume(&report("gemini", None, &["--yolo=false"]), true).unwrap(),
        "gemini --resume 'uuid-123'"
    );
    assert_eq!(
        resume(&report("cursor", None, &["--mode", "ask", "--plan"]), true).unwrap(),
        "cursor-agent --resume 'uuid-123' --mode plan"
    );
}

#[test]
fn restrictive_pi_flags_that_cannot_be_kept_refuse_the_resume() {
    let dir = std::env::temp_dir().join(format!("cairngorm-pi-strict-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("session.jsonl");
    std::fs::write(&path, "{}").unwrap();
    let mut too_many = vec!["--no-mcp"; 33];
    too_many[0] = "--plan";
    for flags in [vec!["--tools", "read, bash"], vec!["--tools="], too_many] {
        let mut r: Report = serde_json::from_value(
            serde_json::json!({"agent": "pi", "id": "uuid-123", "path": path}),
        )
        .unwrap();
        r.flags = flags.iter().map(|s| s.to_string()).collect();
        assert!(resume_args(&r).is_none(), "{flags:?}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn powershell_quotes_typographic_single_quotes() {
    assert_eq!(
        quote("a\u{2019};calc;\u{2019}b", true),
        "'a\u{2019}\u{2019};calc;\u{2019}\u{2019}b'"
    );
    assert_eq!(quote("it's", false), r"'it'\''s'");
}
