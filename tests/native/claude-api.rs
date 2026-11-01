use super::*;

#[test]
fn consent_is_exact_versioned_and_bound_to_runtime() {
    let runtime = AiRuntime::default();
    for text in [
        "",
        "Allow",
        "i understand",
        " I understand",
        "I understand ",
    ] {
        assert!(authorize(&runtime, Some(text))
            .unwrap_err()
            .contains("consent required"));
    }
    let consent = ClaudeApiConsent::new(&runtime);
    assert!(consent.matches(&runtime));
    let mut changed = runtime.clone();
    changed.binary_path = "different-cli".into();
    assert!(!consent.matches(&changed));
    let mut json = serde_json::to_value(consent).unwrap();
    json["version"] = serde_json::json!(0);
    let old: ClaudeApiConsent = serde_json::from_value(json).unwrap();
    assert!(!old.matches(&runtime));
}
