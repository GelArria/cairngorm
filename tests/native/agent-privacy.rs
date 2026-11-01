// Run the native commands in a child test process with an isolated home.
#[test]
fn native_agent_requires_explicit_configuration() {
    if std::env::var_os("CAIRNGORM_PRIVACY_TEST_CHILD").is_some() {
        let home = std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap());
        let path = home.join(".panel/agent/config.json");
        let check_blank = || {
            let env = crate::agent_env::get_agent_env().unwrap();
            assert!(env.api_key.is_none());
            assert!(env.base_url.is_none());
            assert!(env.provider.is_none());
            let view =
                serde_json::to_value(crate::agent_config::get_agent_config().unwrap()).unwrap();
            assert_eq!(view["keySource"], "none");
            assert!(view["keyHint"].is_null());
        };
        check_blank(); // no config: must not fall back to Factory or env
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"provider":"openai","model":"","baseUrl":""}"#).unwrap();
        check_blank(); // first-run config: also no credentials
        std::fs::write(&path, r#"{"provider":"openai","model":"test-model","baseUrl":"https://test.invalid/v1","apiKeyEnv":"OPENAI_API_KEY"}"#).unwrap();
        let env = crate::agent_env::get_agent_env().unwrap();
        assert_eq!(env.api_key.as_deref(), Some("explicit-env-test-key"));
        assert_eq!(env.model.as_deref(), Some("test-model"));
        std::env::remove_var("OPENAI_API_KEY");
        assert!(crate::agent_env::get_agent_env().unwrap().api_key.is_none());
        // Existing plaintext keys migrate to the vault and never serialize over IPC.
        std::fs::write(&path, r#"{"provider":"openai","model":"test-model","baseUrl":"http://internal.test/v1","apiKeyEnv":"OPENAI_API_KEY","apiKey":"migration-test-secret"}"#).unwrap();
        let env = crate::agent_env::get_agent_env().unwrap();
        assert_eq!(env.api_key.as_deref(), Some("migration-test-secret"));
        let serialized = serde_json::to_value(env).unwrap();
        assert!(serialized.get("apiKey").is_none());
        assert_eq!(serialized["keyAvailable"], true);
        let migrated: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(migrated.get("apiKey").is_none());
        assert!(migrated["apiKeyRef"].is_string());
        // Saving to a new endpoint removes the previous reference without copying the key.
        let input = serde_json::from_value(serde_json::json!({
            "provider":"openai", "model":"test-model", "baseUrl":"ws://gateway.test/chat",
            "apiKeyEnv":"OPENAI_API_KEY", "apiKey":null
        }))
        .unwrap();
        crate::agent_config::save_agent_config(input).unwrap();
        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(!saved.contains("apiKeyRef") && !saved.contains("migration-test-secret"));
        return;
    }
    let home = std::env::temp_dir().join(format!("cairngorm-privacy-{}", std::process::id()));
    std::fs::create_dir_all(home.join(".factory")).unwrap();
    std::fs::write(home.join(".factory/settings.json"), r#"{"customModels":[{"model":"personal","baseUrl":"https://personal.invalid/v1","apiKey":"private-factory-test-key"}]}"#).unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "agent_privacy_tests::native_agent_requires_explicit_configuration",
            "--nocapture",
        ])
        .env("CAIRNGORM_PRIVACY_TEST_CHILD", "1")
        .env("USERPROFILE", &home)
        .env("HOME", &home)
        .env("OPENAI_API_KEY", "explicit-env-test-key")
        .output()
        .unwrap();
    std::fs::remove_dir_all(home).unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
