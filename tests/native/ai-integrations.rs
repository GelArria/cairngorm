use crate::{ai_cli, ai_detection, ai_integrations};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

fn temp() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "cairngorm-integration-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&dir).unwrap();
    dir
}

#[test]
fn login_metadata_is_not_mistaken_for_live_verification_or_exposed() {
    let (state, kind, message) = ai_detection::auth_status(
        "claude",
        true,
        r#"{"loggedIn":true,"authMethod":"claude.ai","email":"private@example.com","accessToken":"secret"}"#,
        "",
    );
    assert_eq!(state, "session-detected");
    assert_eq!(kind.as_deref(), Some("subscription"));
    assert!(!message.contains("private") && !message.contains("secret"));
    assert_eq!(
        ai_detection::auth_status("claude", true, r#"{"loggedIn":false}"#, "").0,
        "signed-out"
    );
    assert_eq!(
        ai_detection::auth_status("claude", true, "{}", "").0,
        "check-failed"
    );
    assert_eq!(
        ai_detection::auth_status("claude", false, r#"{"loggedIn":true}"#, "").0,
        "check-failed"
    );
    assert_eq!(
        ai_detection::auth_status("codex", true, "", "Logged in using ChatGPT")
            .1
            .as_deref(),
        Some("subscription")
    );
    assert_eq!(
        ai_detection::auth_status("codex", true, "Logged in using an API key", "")
            .1
            .as_deref(),
        Some("api-or-custom")
    );
    assert_eq!(
        ai_detection::auth_status("codex", false, "", "Not logged in").0,
        "signed-out"
    );
    assert_eq!(
        ai_detection::auth_status("codex", false, "", "unsupported command").0,
        "check-failed"
    );
    assert!(ai_cli::resolve("cmd.exe /c evil").is_none());
}

#[test]
fn every_login_kind_the_clis_report_is_classified() {
    let kind = |id: &str, ok: bool, out: &str, err: &str| {
        let (state, kind, _) = ai_detection::auth_status(id, ok, out, err);
        (state, kind)
    };
    let detected = |kind: &str| ("session-detected".to_string(), Some(kind.to_string()));
    // Claude: `claude setup-token` tokens are subscriptions; notices may surround the JSON.
    let token = "Update available\n{\"loggedIn\":true,\"authMethod\":\"oauth_token\"}\n";
    assert_eq!(kind("claude", true, token, ""), detected("subscription"));
    for method in ["api_key", "api_key_helper", "third_party"] {
        let body = format!("{{\"loggedIn\":true,\"authMethod\":\"{method}\"}}");
        assert_eq!(kind("claude", true, &body, ""), detected("api-or-custom"));
    }
    let login = ai_detection::parse_claude_login(
        true,
        "warn {x}\n{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"subscriptionType\":\"max\"}",
    )
    .unwrap();
    assert!(login.subscription);
    assert_eq!(login.plan.as_deref(), Some("max"));
    assert!(ai_detection::parse_claude_login(false, "{\"loggedIn\":false}").is_none());
    // Gateway bearer tokens are also reported as "oauth_token".
    let token = serde_json::json!({"authMethod": "oauth_token"});
    assert!(ai_detection::claude_login_is_subscription(&token, false));
    assert!(!ai_detection::claude_login_is_subscription(&token, true));
    let web = serde_json::json!({"authMethod": "claude.ai"});
    assert!(ai_detection::claude_login_is_subscription(&web, true));

    // Codex: current wording for API keys, access tokens and Bedrock.
    let api =
        "API key configured - sk-proj-***ABCDE\nAuthentication is checked when you send a request.";
    assert_eq!(kind("codex", true, "", api), detected("api-or-custom"));
    for other in [
        "access token",
        "personal access token",
        "workload identity",
        "Amazon Bedrock API key",
    ] {
        let line = format!("Logged in using {other}");
        assert_eq!(kind("codex", true, "", &line), detected("api-or-custom"));
    }
    let warned =
        "WARNING: proceeding, even though we could not update PATH\nLogged in using ChatGPT";
    assert_eq!(kind("codex", true, "", warned), detected("subscription"));
    let (state, _, message) =
        ai_detection::auth_status("codex", false, "", "Error loading configuration: bad key");
    assert_eq!(state, "check-failed");
    assert!(message.contains("config.toml"));
}

#[test]
fn integration_config_has_no_credentials_and_never_overwrites_corrupt_input() {
    let dir = temp();
    let path = dir.join("integrations.json");
    let cfg = ai_integrations::read_config_at(&path).unwrap();
    assert!(!cfg.setup_complete && cfg.commit_provider.is_none());
    std::fs::write(&path, r#"{"setupComplete":true,"commitProvider":"codex"}"#).unwrap();
    let cfg = ai_integrations::read_config_at(&path).unwrap();
    assert!(cfg.setup_complete);
    assert_eq!(cfg.commit_provider.as_deref(), Some("codex"));
    let json = serde_json::to_value(cfg).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 2);
    std::fs::write(&path, "{invalid").unwrap();
    assert!(ai_integrations::read_config_at(&path).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{invalid");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn cli_only_returns_final_drafts_and_disables_repository_tools() {
    assert_eq!(
        ai_cli::parse_draft(
            "claude",
            r#"{"is_error":false,"result":"fix: preserve login"}"#
        )
        .unwrap(),
        "fix: preserve login"
    );
    assert!(
        ai_cli::parse_draft("claude", r#"{"is_error":true,"result":"secret error"}"#)
            .unwrap_err()
            .find("secret")
            .is_none()
    );
    assert!(ai_cli::parse_draft("claude", "not json").is_err());
    let codex = "{\"type\":\"item.completed\",\"item\":{\"type\":\"reasoning\",\"text\":\"private reasoning\"}}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"feat: detect services\"}}";
    assert_eq!(
        ai_cli::parse_draft("codex", codex).unwrap(),
        "feat: detect services"
    );
    assert!(ai_cli::parse_draft("codex", "{\"type\":\"error\",\"message\":\"secret\"}").is_err());
    assert!(
        ai_cli::request_error("You’ve hit your usage limit. secret-token")
            .contains("usage limit reached")
    );
    assert!(!ai_cli::request_error("secret-token").contains("secret-token"));
    let claude = ai_cli::draft_args("claude");
    assert!(claude.windows(2).any(|p| p == ["--tools", ""]));
    assert!(claude.contains(&"--strict-mcp-config".into()));
    assert!(claude.contains(&"{\"disableAllHooks\":true}".into()));
    let codex = ai_cli::draft_args("codex");
    for flag in [
        "read-only",
        "features.shell_tool=false",
        "features.hooks=false",
        "features.remote_plugin=false",
        "notify=[]",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
    ] {
        assert!(codex.contains(&flag.into()));
    }
}

#[test]
fn cli_runner_passes_untrusted_input_over_stdin_and_has_a_deadline() {
    let dir = temp();
    let script = dir.join("fake.js");
    std::fs::write(&script, "process.stdin.setEncoding('utf8'); let text=''; process.stdin.on('data', x => text+=x); process.stdin.on('end', () => { console.log(JSON.stringify({is_error:false,result:text})); });").unwrap();
    let input = "diff & \"$(evil)\"\nUnicode: ñ 💎";
    let (ok, out, _) = ai_cli::run(
        ai_cli::command(&script).unwrap(),
        Some(input.into()),
        Duration::from_secs(5),
    )
    .unwrap();
    assert!(ok);
    assert_eq!(ai_cli::parse_draft("claude", &out).unwrap(), input);
    std::fs::write(&script, "setInterval(() => {}, 1000);").unwrap();
    let start = Instant::now();
    let error = ai_cli::run(
        ai_cli::command(&script).unwrap(),
        Some("x".repeat(200_000)),
        Duration::from_millis(150),
    )
    .unwrap_err();
    assert!(error.contains("timed out"));
    assert!(start.elapsed() < Duration::from_secs(5));
    // A helper can keep inherited stdout/stderr open after its parent exits.
    std::fs::write(&script, "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {stdio:['ignore',1,2]}); process.exit(0);").unwrap();
    let start = Instant::now();
    let (ok, _, _) = ai_cli::run(
        ai_cli::command(&script).unwrap(),
        None,
        Duration::from_secs(2),
    )
    .unwrap();
    assert!(ok);
    assert!(start.elapsed() < Duration::from_secs(2));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
#[ignore = "read-only smoke test of this machine's installed official CLIs"]
fn installed_cli_detection() {
    let view = tauri::async_runtime::block_on(ai_integrations::detect_ai_services()).unwrap();
    let view = serde_json::to_value(view).unwrap();
    for service in view["services"].as_array().unwrap() {
        println!(
            "{}: status={}, auth={}",
            service["name"], service["status"], service["authKind"]
        );
    }
}
