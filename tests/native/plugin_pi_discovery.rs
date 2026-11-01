use super::agents;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

fn home() -> PathBuf {
    let home =
        std::env::temp_dir().join(format!("cairngorm-pi-discovery-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(home.join(".pi/agent")).unwrap();
    home
}

#[test]
fn pi_gets_model_visible_visual_tools_with_and_without_the_lazy_adapter() {
    for (filename, key, expected) in [
        ("mcp-adapter.json", "directTools", json!(true)),
        ("mcp.json", "exposure", json!("direct")),
    ] {
        let home = home();
        let file = home.join(".pi/agent").join(filename);
        fs::write(
            &file,
            "{ /* keep */ \"mcpServers\": { \"tldraw\": {\"command\": \"file-export\"} } }",
        )
        .unwrap();
        let report = agents::register(&home, &|_| None, "node", "C:/app/bridge.cjs");
        assert!(report[0].error.is_none());
        let text = fs::read_to_string(&file).unwrap();
        let value: Value =
            serde_json::from_str(&crate::integration_config::clean_jsonc(&text)).unwrap();
        assert_eq!(
            value["mcpServers"]["cairngorm"][key], expected,
            "the actual visual schemas must reach the model at startup"
        );
        if filename == "mcp-adapter.json" {
            assert_eq!(value["mcpServers"]["cairngorm"]["lifecycle"], "keep-alive");
        }
        assert!(text.contains("/* keep */") && text.contains("file-export"));
        let before = fs::read(&file).unwrap();
        agents::register(&home, &|_| None, "node", "C:/app/bridge.cjs");
        assert_eq!(fs::read(&file).unwrap(), before);
        fs::remove_dir_all(home).ok();
    }
}

#[test]
fn explicit_user_visibility_choices_are_not_overridden() {
    for (filename, options) in [
        (
            "mcp-adapter.json",
            json!({"directTools": false, "lifecycle": "lazy", "description": "Custom"}),
        ),
        (
            "mcp.json",
            json!({"exposure": "deferred", "description": "Custom"}),
        ),
    ] {
        let home = home();
        let file = home.join(".pi/agent").join(filename);
        let mut entry = options;
        entry["command"] = json!("node");
        entry["args"] = json!(["C:/app/bridge.cjs"]);
        let text = serde_json::to_string(&json!({"mcpServers": {"cairngorm": entry}})).unwrap();
        fs::write(&file, &text).unwrap();
        let report = agents::register(&home, &|_| None, "node", "C:/app/bridge.cjs");
        assert!(report[0].error.is_none());
        assert_eq!(fs::read_to_string(&file).unwrap(), text);
        assert!(!file.with_extension("cairngorm-backup").exists());
        fs::remove_dir_all(home).ok();
    }
}

#[test]
fn an_existing_owned_bridge_is_upgraded_without_replacing_options_or_other_servers() {
    let home = home();
    let file = home.join(".pi/agent/mcp-adapter.json");
    let original = "\u{feff}{ /* root */ \"mcpServers\": {\"cairngorm\": { /* local */ \"command\":\"node\",\"args\":[\"C:/app/bridge.cjs\"],\"env\":{\"CUSTOM\":\"keep\"}},\"tldraw\":{\"command\":\"file-export\"}}}";
    fs::write(&file, original).unwrap();
    let report = agents::register(&home, &|_| None, "node", "C:/app/bridge.cjs");
    assert!(report[0].error.is_none());
    let text = fs::read_to_string(&file).unwrap();
    let value: Value = serde_json::from_str(&crate::integration_config::clean_jsonc(
        text.trim_start_matches('\u{feff}'),
    ))
    .unwrap();
    assert_eq!(value["mcpServers"]["cairngorm"]["directTools"], true);
    assert_eq!(value["mcpServers"]["cairngorm"]["env"]["CUSTOM"], "keep");
    assert!(
        text.starts_with('\u{feff}') && text.contains("/* root */") && text.contains("/* local */")
    );
    assert_eq!(
        fs::read_to_string(file.with_extension("cairngorm-backup")).unwrap(),
        original
    );
    fs::remove_dir_all(home).ok();
}
