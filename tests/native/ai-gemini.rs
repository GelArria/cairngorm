use crate::ai_gemini::{
    agent_args, auth_status, cli_home, config_folder, draft_args, env_auth, parse_draft,
    selected_auth,
};
use crate::ai_runtime::{env_name, AiRuntime};
use std::path::PathBuf;

#[test]
fn login_comes_from_the_saved_auth_method_never_from_credentials() {
    let google = r#"{
      // Comments are allowed in Gemini CLI settings.
      "security": { "auth": { "selectedType" : "oauth-personal" } }
    }"#;
    assert_eq!(selected_auth(google).as_deref(), Some("oauth-personal"));
    let (status, kind, _) = auth_status(Some(google), None);
    assert_eq!(
        (status.as_str(), kind.as_deref()),
        ("session-detected", Some("subscription"))
    );

    let key = r#"{"security":{"auth":{"selectedType":"gemini-api-key"}}}"#;
    assert_eq!(
        auth_status(Some(key), None).1.as_deref(),
        Some("api-or-custom")
    );
    // An API key in the environment works without a saved choice.
    assert_eq!(
        auth_status(Some("{}"), Some("gemini-api-key")).1.as_deref(),
        Some("api-or-custom")
    );
    assert_eq!(auth_status(None, None).0, "signed-out");
}

#[test]
fn every_run_turns_off_extensions_and_mcp_servers() {
    for args in [draft_args(), agent_args()] {
        let at = args.iter().position(|a| a == "--extensions").unwrap();
        assert_eq!(args[at + 1], "none");
        assert!(args.contains(&"--allowed-mcp-server-names".to_string()));
        // Shell commands always need an approval a headless run cannot give.
        assert!(!args
            .iter()
            .any(|a| a == "yolo" || a == "--yolo" || a == "-y"));
    }
    assert!(draft_args().contains(&"default".to_string()));
    assert!(agent_args().contains(&"auto_edit".to_string()));
}

#[test]
fn drafts_read_the_json_response_and_report_quota() {
    let output = "Loaded cached credentials.\n{\"session_id\":\"x\",\"response\":\"feat: add\\n\"}";
    assert_eq!(parse_draft(output).unwrap(), "feat: add\n");
    let failed =
        r#"{"error":{"type":"QuotaError","message":"You have exhausted your daily quota"}}"#;
    assert!(parse_draft(failed).unwrap_err().contains("usage limit"));
    assert!(parse_draft("not json").is_err());
    assert_eq!(
        crate::ai_cli::parse_draft("gemini", r#"{"response":"  fix: typo  "}"#).unwrap(),
        "fix: typo"
    );
}

#[test]
fn a_chosen_folder_maps_to_gemini_cli_home() {
    let root = std::env::temp_dir().join("gemini-root");
    assert_eq!(config_folder(root.clone()), root.join(".gemini"));
    assert_eq!(config_folder(root.join(".gemini")), root.join(".gemini"));
    assert_eq!(cli_home(&root.join(".gemini")), root);
    assert_eq!(env_name("gemini"), "GEMINI_CLI_HOME");

    let runtime = AiRuntime {
        binary_path: String::new(),
        home_path: root.to_string_lossy().into_owned(),
    };
    assert_eq!(runtime.config_home("gemini").unwrap(), root.join(".gemini"));
    let mut command = std::process::Command::new("gemini");
    runtime.apply(&mut command, "gemini").unwrap();
    let value = command
        .get_envs()
        .find(|(name, _)| *name == "GEMINI_CLI_HOME")
        .and_then(|(_, value)| value)
        .map(PathBuf::from);
    assert_eq!(value, Some(root));
}

#[test]
fn npm_launchers_resolve_to_the_gemini_cli_script() {
    let dir = std::env::temp_dir().join(format!("cairngorm-gemini-{}", uuid::Uuid::new_v4()));
    let script = dir.join("node_modules/@google/gemini-cli/bundle/gemini.js");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "#!/usr/bin/env node\n").unwrap();
    let launcher = dir.join("gemini.cmd");
    std::fs::write(&launcher, "@echo off\r\n").unwrap();
    let runtime = AiRuntime {
        binary_path: launcher.to_string_lossy().into_owned(),
        home_path: String::new(),
    };
    // Node may be missing on a build host; only the chosen script matters here.
    if which::which("node").is_ok() {
        assert_eq!(runtime.resolve("gemini").unwrap(), Some(script));
    }
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn every_run_gets_an_admin_policy_that_denies_shell_web_and_mcp() {
    use crate::ai_gemini_isolation::{policy, prepare};
    let draft = policy(false);
    assert!(draft.contains("toolName = \"*\"") && draft.contains("decision = \"deny\""));
    assert!(!draft.contains("\"allow\""));
    let agent = policy(true);
    for tool in ["read_file", "replace", "write_file", "grep_search"] {
        assert!(agent.contains(&format!("\"{tool}\"")), "{tool}");
    }
    for tool in [
        "run_shell_command",
        "web_fetch",
        "google_web_search",
        "save_memory",
    ] {
        assert!(!agent.contains(tool), "{tool}");
    }

    let dir =
        std::env::temp_dir().join(format!("cairngorm-gemini-policy-{}", uuid::Uuid::new_v4()));
    let isolation = prepare(&dir, true).unwrap();
    assert_eq!(isolation.args[0], "--admin-policy");
    assert_eq!(std::fs::read_to_string(&isolation.args[1]).unwrap(), agent);
    // Hooks are turned off only through Cairngorm's own system settings file.
    for (name, value) in &isolation.env {
        assert_eq!(name, "GEMINI_CLI_SYSTEM_SETTINGS_PATH");
        assert!(std::fs::read_to_string(value)
            .unwrap()
            .contains("\"enabled\": false"));
    }
    std::fs::remove_dir_all(dir).ok();
}

#[test]
fn drafts_ignore_noise_and_auth_ignores_commented_lines() {
    let noisy = "Warning {not json}\n{\"response\":\"chore: x\"}\ntrailing {";
    assert_eq!(parse_draft(noisy).unwrap(), "chore: x");
    let commented = "{\n  // \"selectedType\": \"oauth-personal\",\n  \"security\": {\"auth\": {\"selectedType\": \"vertex-ai\"}}\n}";
    assert_eq!(selected_auth(commented).as_deref(), Some("vertex-ai"));
}

#[test]
fn legacy_settings_and_environment_logins_are_detected() {
    // Settings saved before the v2 layout.
    let legacy = r#"{ "selectedAuthType": "oauth-personal", "theme": "Default" }"#;
    assert_eq!(
        auth_status(Some(legacy), None).1.as_deref(),
        Some("subscription")
    );
    let env = |pairs: &'static [(&'static str, &'static str)]| {
        move |name: &str| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        }
    };
    assert_eq!(
        env_auth(env(&[("GOOGLE_GENAI_USE_GCA", "true")])),
        Some("oauth-personal")
    );
    assert_eq!(
        env_auth(env(&[("GOOGLE_GENAI_USE_VERTEXAI", "false")])),
        None
    );
    assert_eq!(
        env_auth(env(&[("GEMINI_API_KEY", "k")])),
        Some("gemini-api-key")
    );
    let (state, kind, _) = auth_status(None, env_auth(env(&[("GOOGLE_GENAI_USE_GCA", "true")])));
    assert_eq!(env_auth(env(&[("GOOGLE_GENAI_USE_GCA", "TRUE")])), None);
    assert_eq!(
        (state.as_str(), kind.as_deref()),
        ("session-detected", Some("subscription"))
    );
    // A saved choice wins over the environment.
    let key = r#"{"security":{"auth":{"selectedType":"gemini-api-key"}}}"#;
    assert_eq!(
        auth_status(Some(key), Some("oauth-personal")).1.as_deref(),
        Some("api-or-custom")
    );
}
