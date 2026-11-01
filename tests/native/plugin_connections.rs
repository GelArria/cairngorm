use super::{agent_targets, agents, callers, catalog, mcp};
use serde_json::json;
use std::{ffi::OsString, fs, path::PathBuf};

fn temp_home() -> PathBuf {
    let home =
        std::env::temp_dir().join(format!("cairngorm-plugin-connect-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&home).unwrap();
    home
}

fn no_env(_: &str) -> Option<OsString> {
    None
}

#[test]
fn approval_is_explicit_and_survives_plugin_additions_and_removal() {
    let dir = temp_home();
    assert!(!catalog::agents_connected(&dir));
    catalog::set_enabled(&dir, "tldraw", true).unwrap();
    assert!(
        !catalog::agents_connected(&dir),
        "legacy enabled plugins are not consent"
    );
    catalog::connect_agents(&dir).unwrap();
    catalog::set_enabled(&dir, "drawio", true).unwrap();
    catalog::set_enabled(&dir, "tldraw", false).unwrap();
    assert!(catalog::agents_connected(&dir));
    assert_eq!(
        catalog::enabled(&dir)
            .iter()
            .map(|p| p.id)
            .collect::<Vec<_>>(),
        ["drawio"]
    );
    let before = fs::read(catalog::settings_path(&dir)).unwrap();
    catalog::connect_agents(&dir).unwrap();
    assert_eq!(fs::read(catalog::settings_path(&dir)).unwrap(), before);
    fs::write(catalog::settings_path(&dir), "broken settings").unwrap();
    assert!(catalog::connect_agents(&dir).is_err());
    assert_eq!(
        fs::read_to_string(catalog::settings_path(&dir)).unwrap(),
        "broken settings"
    );
    fs::remove_dir_all(dir).ok();
}

#[test]
fn one_bridge_registers_all_supported_clients_without_replacing_other_servers() {
    let home = temp_home();
    let bridge = "C:/app/plugins/mcp-bridge.cjs";
    for target in agent_targets::targets(&home, &no_env) {
        fs::create_dir_all(target.markers.first().unwrap()).unwrap();
    }
    let pi = home.join(".pi/agent/mcp.json");
    fs::write(
        &pi,
        r#"{ "mcpServers": { "existing": { "command": "keep-me" } } }"#,
    )
    .unwrap();
    let report = agents::register(&home, &no_env, "node", bridge);
    assert!(report.len() >= 13);
    assert!(report.iter().all(|a| a.registered && a.error.is_none()));
    assert!(fs::read_to_string(&pi).unwrap().contains("keep-me"));
    let before = fs::read(&pi).unwrap();
    agents::register(&home, &no_env, "node", bridge);
    assert_eq!(fs::read(&pi).unwrap(), before);
    fs::remove_dir_all(home).ok();
}

#[test]
fn pi_uses_its_config_override_and_existing_adapter_without_touching_native_config() {
    let home = temp_home();
    let custom = home.join("custom-pi");
    fs::create_dir_all(&custom).unwrap();
    let env = |name: &str| (name == "PI_CODING_AGENT_DIR").then(|| custom.clone().into_os_string());
    let adapter = custom.join("mcp-adapter.json");
    fs::write(&adapter, "{ /* keep */ \"mcpServers\": {} }").unwrap();
    let report = agents::register(&home, &env, "node", "C:/app/bridge.cjs");
    assert_eq!(report.len(), 1);
    assert_eq!(report[0].id, "pi");
    assert!(report[0].registered);
    assert!(fs::read_to_string(adapter).unwrap().contains("/* keep */"));
    assert!(!custom.join("mcp.json").exists());
    assert_eq!(callers::agent_in("pi/1"), Some("pi"));
    assert_eq!(callers::agent_in("api-client"), None);
    let cmd = vec![
        "node".into(),
        "C:/npm/@earendil-works/pi-coding-agent/dist/cli.js".into(),
    ];
    assert_eq!(callers::agent_of_process("node.exe", "", &cmd), Some("pi"));
    fs::remove_dir_all(home).ok();
}

#[test]
fn disabled_foreign_and_invalid_client_configs_are_never_overwritten_or_reported_connected() {
    for text in [
        r#"{"mcpServers":{"cairngorm":{"command":"node","args":["C:/app/bridge.cjs"],"disabled":true}}}"#,
        r#"{"mcpServers":{"cairngorm":{"command":"node","args":["D:/foreign/bridge.cjs"]}}}"#,
        r#"{"mcpServers":{"cairngorm":{"command":"node","args":["C:/app/bridge.cjs.old"]}}}"#,
        r#"{"mcpServers":{"cairngorm":{"command":"node","args":["foreign.cjs"],"env":{"BRIDGE":"C:/app/bridge.cjs"}}}}"#,
        r#"{"mcpServers":{"cairngorm":{"command":"node","args":["foreign.cjs","C:/app/bridge.cjs"]}}}"#,
        "not json",
    ] {
        let home = temp_home();
        fs::create_dir_all(home.join(".pi/agent")).unwrap();
        let config = home.join(".pi/agent/mcp-adapter.json");
        fs::write(&config, text).unwrap();
        let report = agents::register(&home, &no_env, "node", "C:/app/bridge.cjs");
        assert!(!report[0].registered);
        assert!(report[0].error.is_some());
        let status = agents::status(&home, &no_env, "C:/app/bridge.cjs");
        assert!(!status[0].registered);
        assert!(status[0].error.is_some());
        assert_eq!(fs::read_to_string(config).unwrap(), text);
        fs::remove_dir_all(home).ok();
    }
}

#[test]
fn visual_tool_descriptions_explain_that_cairngorm_opens_the_panel() {
    let tool = json!({"description":"Draw a diagram", "_meta":{"ui":{"resourceUri":"ui://view"}}});
    assert!(mcp::tool_description(&tool).starts_with("Opens an interactive panel"));
    assert_eq!(
        mcp::tool_description(&json!({"description":"Search docs"})),
        "Search docs"
    );
    let handshake = mcp::initialize(&json!({}), &[]);
    assert!(handshake["instructions"]
        .as_str()
        .unwrap()
        .contains("similarly named file-export servers"));
}
