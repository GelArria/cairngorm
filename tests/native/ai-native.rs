#[test]
#[ignore = "Uses the existing Codex login and a small amount of model quota"]
fn live_codex_subscription_verification() {
    let result = crate::ai_cli::request(
        "codex",
        &crate::ai_runtime::AiRuntime::default(),
        "Reply with exactly CAIRNGORM_OK. Do not use tools.".into(),
        None,
    )
    .unwrap();
    assert_eq!(result, "CAIRNGORM_OK");
}

#[test]
#[ignore = "Uses the existing Codex login for two short native-agent model requests"]
fn live_codex_native_sidecar_continues_a_conversation_without_an_api_key() {
    let dir = std::env::temp_dir().join(format!("cairngorm-native-live-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let source =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/agent/core/src/cli.ts");
    let mut command = crate::ai_cli::command(&which::which("bun").unwrap()).unwrap();
    command
        .current_dir(&dir)
        .arg(source)
        .args(["--sidecar", "--codex", "--session-id", "live-native-test"])
        .env_remove("OPENAI_API_KEY")
        .env_remove("OPENAI_BASE_URL");
    for (key, value) in
        crate::ai_native::codex_environment(&crate::ai_runtime::AiRuntime::default()).unwrap()
    {
        command.env(key, value);
    }
    let input = "{\"type\":\"prompt\",\"content\":\"Reply with exactly NATIVE_OK. Do not use tools.\"}\n{\"type\":\"prompt\",\"content\":\"Repeat the exact token from your previous reply. Reply with that token only. Do not use tools.\"}\n";
    let result = crate::ai_cli::run(
        command,
        Some(input.into()),
        std::time::Duration::from_secs(120),
    );
    std::fs::remove_dir_all(dir).unwrap();
    let (ok, output, _) = result.unwrap();
    assert!(ok);
    let events: Vec<serde_json::Value> = output
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let replies: Vec<_> = events
        .iter()
        .filter(|e| e["type"] == "message_update")
        .map(|e| e["assistantMessageEvent"]["delta"].as_str().unwrap())
        .collect();
    assert_eq!(replies, ["NATIVE_OK", "NATIVE_OK"]);
    assert_eq!(
        events.iter().filter(|e| e["type"] == "agent_end").count(),
        2
    );
    assert!(events.iter().all(|e| e["session_id"] == "live-native-test"));
}
