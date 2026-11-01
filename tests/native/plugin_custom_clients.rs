use super::clients::{self, ClientFormat};
use serde_json::json;
use std::{fs, path::PathBuf};

fn temp() -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("cairngorm-custom-client-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn unknown_clients_register_without_editing_then_connect_and_disconnect_in_every_format() {
    for (format, filename, original) in [
        (
            ClientFormat::Json,
            "client.json",
            "{ /* keep */ \"mcpServers\": {\"other\": {\"command\": \"keep\"}} }",
        ),
        (ClientFormat::TypedJson, "client.jsonc", "{}"),
        (ClientFormat::Json, "bom.json", "\u{feff}{ /* keep */ }"),
        (
            ClientFormat::Toml,
            "bom.toml",
            "\u{feff}# keep\nmodel = 'custom'\n",
        ),
        (
            ClientFormat::OpenCode,
            "client.json",
            "{\"mcp\": {\"other\": {\"command\": [\"keep\"]}}}",
        ),
        (ClientFormat::Copilot, "client.json", "{}"),
        (
            ClientFormat::Toml,
            "client.toml",
            "# keep\nmodel = 'custom'\n",
        ),
    ] {
        let dir = temp();
        let registry = dir.join("plugins");
        let file = dir.join(filename);
        fs::write(&file, original).unwrap();
        let script = "C:/cairngorm/plugins/mcp-bridge.cjs";
        clients::add(&registry, "My CLI".into(), file.clone(), format).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), original);
        let before = clients::list(&registry, script).unwrap();
        assert!(!before[0].registered && before[0].activity.is_none());
        let id = &before[0].client.id;
        clients::connect(&registry, id, script, true).unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.contains("--client") && text.contains(id));
        assert_eq!(
            fs::read_to_string(file.with_extension("cairngorm-backup")).unwrap(),
            original
        );
        let connected = clients::list(&registry, script).unwrap();
        assert!(connected[0].registered);
        assert!(
            connected[0].activity.is_none(),
            "config writes are not connection proof"
        );
        clients::connect(&registry, id, script, true).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), text);
        clients::connect(&registry, id, script, false).unwrap();
        assert!(!clients::list(&registry, script).unwrap()[0].registered);
        let restored = fs::read_to_string(&file).unwrap();
        assert!(!restored.contains("mcp-bridge.cjs"));
        assert_eq!(
            restored.starts_with('\u{feff}'),
            original.starts_with('\u{feff}')
        );
        if original.contains("keep") {
            assert!(restored.contains("keep"));
        }
        clients::forget(&registry, id, script).unwrap();
        assert!(clients::list(&registry, script).unwrap().is_empty());
        fs::remove_dir_all(dir).ok();
    }
}

#[test]
fn invalid_duplicate_and_foreign_configs_stay_unchanged() {
    let dir = temp();
    let registry = dir.join("plugins");
    let file = dir.join("agent.json");
    fs::write(&file, "not JSON").unwrap();
    assert!(clients::add(&registry, "CLI".into(), file.clone(), ClientFormat::Json).is_err());
    assert!(!registry.join("clients.json").exists());
    fs::write(&file, "{}").unwrap();
    assert!(clients::add(&registry, "\n".into(), file.clone(), ClientFormat::Json).is_err());
    assert!(clients::add(
        &registry,
        "CLI".into(),
        PathBuf::from("relative.json"),
        ClientFormat::Json
    )
    .is_err());
    clients::add(&registry, "CLI".into(), file.clone(), ClientFormat::Json).unwrap();
    assert!(clients::add(&registry, "Again".into(), file.clone(), ClientFormat::Json).is_err());
    let script = "C:/cairngorm/mcp-bridge.cjs";
    let id = clients::list(&registry, script).unwrap()[0]
        .client
        .id
        .clone();
    let foreign = json!({"mcpServers":{"cairngorm":{"command":"node","args":[script,"--client","another-id"]}}}).to_string();
    fs::write(&file, &foreign).unwrap();
    assert!(clients::connect(&registry, &id, script, true).is_err());
    assert!(clients::connect(&registry, &id, script, false).is_err());
    clients::forget(&registry, &id, script).unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), foreign);
    fs::write(registry.join("clients.json"), "broken registry").unwrap();
    assert!(clients::add(&registry, "New".into(), file, ClientFormat::Json).is_err());
    assert_eq!(
        fs::read_to_string(registry.join("clients.json")).unwrap(),
        "broken registry"
    );
    fs::remove_dir_all(dir).ok();
}
