use super::*;
use serde_json::json;
use std::fs;
#[path = "plugin_file_scope_fixture.rs"]
mod fixture;

#[test]
fn unknown_untagged_and_disabled_clients_cannot_use_files_even_with_a_live_project_scope() {
    let scratch = fixture::Scratch::new();
    let home = scratch.0.join("home");
    let dir = scratch.0.join("plugins");
    fs::create_dir_all(home.join(".claude")).unwrap();
    let bridge = dir.join("mcp-bridge.cjs").to_string_lossy().into_owned();
    let check = |registration, agent| allowed(&dir, &home, &|_| None, &bridge, registration, agent);
    assert!(!check(None, None));
    assert!(!check(Some(""), None));
    assert!(!check(None, Some("unknown")));
    assert!(!check(None, Some("claude")));
    let config = home.join(".claude.json");
    fs::write(
        &config,
        json!({"mcpServers":{"cairngorm":{"command":"node", "args":[bridge]}}}).to_string(),
    )
    .unwrap();
    assert!(check(None, Some("claude")));
    assert!(!check(None, None)); // A spoofed handshake cannot supply the process-derived agent.
    assert!(!check(Some("unregistered"), Some("claude")));
    fs::write(
        &config,
        json!({"mcpServers":{"cairngorm":{"command":"node", "args":[bridge], "disabled":true}}})
            .to_string(),
    )
    .unwrap();
    assert!(!check(None, Some("claude")));
    let config = scratch.0.join("custom-client.json");
    fs::write(&config, "{}").unwrap();
    clients::add(
        &dir,
        "Custom".into(),
        config.clone(),
        clients::ClientFormat::Json,
    )
    .unwrap();
    let id = clients::list(&dir, &bridge).unwrap()[0].client.id.clone();
    assert!(!check(Some(&id), None));
    fs::write(
        &config,
        json!({"mcpServers":{"cairngorm":{"command":"node", "args":[bridge, "--client", id]}}})
            .to_string(),
    )
    .unwrap();
    assert!(check(Some(&id), None));
    assert!(!check(None, None));
    fs::write(&config, json!({"mcpServers":{"cairngorm":{"command":"node", "args":[bridge, "--client", id], "enabled":false}}}).to_string()).unwrap();
    assert!(!check(Some(&id), None));
    fs::write(&config, "{}").unwrap();
    assert!(!check(Some(&id), None));
}
