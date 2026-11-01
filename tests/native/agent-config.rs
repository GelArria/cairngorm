use super::*;
use serde_json::json;

#[cfg(windows)]
#[test]
fn system_vault_roundtrip_uses_a_disposable_entry() {
    let id = uuid::Uuid::new_v4().to_string();
    let entry = keyring::Entry::new("com.cairngorm.validation", &id).unwrap();
    entry.set_password("disposable-validation-value").unwrap();
    let loaded = keyring::Entry::new("com.cairngorm.validation", &id)
        .unwrap()
        .get_password();
    entry.delete_credential().unwrap();
    assert_eq!(loaded.unwrap(), "disposable-validation-value");
}

#[test]
fn internal_http_and_websocket_are_allowed_without_embedded_credentials() {
    assert_eq!(
        validate_base_url("http://inference.example/v1"),
        Ok("http://inference.example/v1".into())
    );
    assert_eq!(
        validate_base_url("wss://gateway.example/ws"),
        Ok("wss://gateway.example/ws".into())
    );
    assert!(validate_base_url("https://user:pass@example.test/v1").is_err());
    assert!(validate_base_url("https://provider.example/v1?api_key=secret").is_err());
    assert!(validate_base_url("https://provider.example/v1#secret").is_err());
    assert_eq!(
        validate_base_url("http://localhost:11434/v1/"),
        Ok("http://localhost:11434/v1".into())
    );
    assert!(is_loopback_url("http://127.0.0.1:11434/v1"));
}

#[test]
fn changing_target_requires_a_new_saved_key() {
    let cfg = json!({
        "provider": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "apiKeyEnv": "OPENAI_API_KEY"
    });
    let cfg = cfg.as_object().unwrap();
    assert!(!target_changed(
        cfg,
        "openai",
        "https://api.openai.com/v1",
        "OPENAI_API_KEY"
    ));
    assert!(target_changed(
        cfg,
        "deepseek",
        "https://api.deepseek.com",
        "DEEPSEEK_API_KEY"
    ));
}
