use super::*;
use serde_json::json;

#[test]
fn registrations_preserve_jsonc_and_are_idempotent() {
    for text in [
        "{}",
        "{ /* keep comments */ \"theme\": \"dark\" }",
        "{\"nested\": {\"plugin\": []}, \"plugin\": [\"keep\",]}",
        "{\"name\":\"plugin\",\"plugin\":[[\"keep\",{\"x\":true}], /* keep */]}",
    ] {
        let updated = add_plugin(text, "plugin", "./cairngorm-session.js").unwrap();
        let value: Value = serde_json::from_str(&clean_jsonc(&updated)).unwrap();
        assert!(value["plugin"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "./cairngorm-session.js"));
        assert_eq!(
            add_plugin(&updated, "plugin", "./cairngorm-session.js").unwrap(),
            updated
        );
        if text.contains("keep comments") {
            assert!(updated.contains("keep comments"));
        }
        if text.contains("nested") {
            assert_eq!(value["nested"]["plugin"], json!([]));
        }
    }
    assert!(add_plugin("{bad", "plugin", "ours").is_err());
    assert!(add_plugin("{\"plugin\":{}}", "plugin", "ours").is_err());
}

#[cfg(unix)]
#[test]
fn replacing_settings_and_backup_preserves_private_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = std::env::temp_dir().join(format!("cairngorm-permissions-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settings.json");
    fs::write(&path, "{\"private\":true}").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    write_config(&path, "{}").unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(path.with_extension("cairngorm-backup"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn claude_permission_hooks_are_idempotent_and_preserve_user_hooks() {
    let dir = std::env::temp_dir().join(format!("cairngorm-claude-hooks-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settings.json");
    fs::write(
        &path,
        r#"{"hooks":{"Stop":[{"hooks":[{"command":"user-stop"}]}]}}"#,
    )
    .unwrap();
    for _ in 0..2 {
        crate::agent_integrations::install_hook(&dir, "claude").unwrap();
    }
    let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    for event in ["SessionStart", "UserPromptSubmit", "Stop"] {
        assert_eq!(
            value["hooks"][event].as_array().unwrap().len(),
            if event == "Stop" { 2 } else { 1 }
        );
    }
    assert_eq!(
        value["hooks"]["Stop"][0]["hooks"][0]["command"],
        "user-stop"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[cfg(windows)]
#[test]
fn interpolated_hook_paths_are_rejected_without_changing_settings() {
    let root = std::env::temp_dir().join(format!("cairngorm-hook-paths-{}", uuid::Uuid::new_v4()));
    for name in ["dev$profile", "dev`profile"] {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        let settings = dir.join("settings.json");
        let original = r#"{"model":"keep"}"#;
        fs::write(&settings, original).unwrap();
        let result = crate::agent_integrations::install_hook(&dir, "claude");
        assert!(result.is_err(), "unsafe hook path accepted: {name}");
        assert_eq!(fs::read_to_string(&settings).unwrap(), original);
        assert!(!settings.with_extension("cairngorm-backup").exists());
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn merging_session_hooks_preserves_user_settings_and_backups() {
    let dir = std::env::temp_dir().join(format!("cairngorm-integrations-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join(".factory")).unwrap();
    let settings = dir.join(".factory/settings.json");
    let original =
        r#"{"model":"keep","hooks":{"SessionStart":[{"hooks":[{"command":"my-hook"}]}]}}"#;
    fs::write(&settings, original).unwrap();
    // No PI/XDG env overrides in this test: call the isolated hook installer directly.
    crate::agent_integrations::install_hook(&dir.join(".factory"), "droid").unwrap();
    crate::agent_integrations::install_hook(&dir.join(".factory"), "droid").unwrap();
    let value: Value = serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
    assert_eq!(value["model"], "keep");
    assert_eq!(value["hooks"]["SessionStart"].as_array().unwrap().len(), 2);
    assert_eq!(
        fs::read_to_string(settings.with_extension("cairngorm-backup")).unwrap(),
        original
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn cursor_grok_and_codex_hooks_use_each_agent_layout() {
    use crate::agent_integrations::{install_hook_into, HookLayout};
    let dir = std::env::temp_dir().join(format!("cairngorm-agent-hooks-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let cursor = dir.join("hooks.json");
    fs::write(
        &cursor,
        r#"{"version":1,"hooks":{"stop":[{"command":"user-stop"}]}}"#,
    )
    .unwrap();
    for _ in 0..2 {
        install_hook_into(&dir, &cursor, "cursor", HookLayout::Cursor).unwrap();
    }
    let value: Value = serde_json::from_str(&fs::read_to_string(&cursor).unwrap()).unwrap();
    assert_eq!(value["hooks"]["stop"][0]["command"], "user-stop");
    let start = value["hooks"]["sessionStart"].as_array().unwrap();
    assert_eq!(start.len(), 1);
    assert!(start[0]["command"].as_str().unwrap().ends_with(" cursor"));

    let grok = dir.join("hooks/cairngorm.json");
    install_hook_into(&dir, &grok, "grok", HookLayout::Nested { timeout: 5 }).unwrap();
    let value: Value = serde_json::from_str(&fs::read_to_string(&grok).unwrap()).unwrap();
    let command = value["hooks"]["SessionStart"][0]["hooks"][0]["command"]
        .as_str()
        .unwrap();
    assert!(command.ends_with(" grok"));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn codex_keeps_a_trusted_imported_hook_and_adds_only_missing_events() {
    use crate::agent_integrations::{install_hook_into, HookLayout};
    let dir = std::env::temp_dir().join(format!("cairngorm-codex-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let config = dir.join("hooks.json");
    let imported =
        r#"powershell.exe -File "C:/Users/me/.claude/hooks/cairngorm-session.ps1" claude"#;
    fs::write(
        &config,
        serde_json::to_string(&serde_json::json!({"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":imported}]}]}}))
            .unwrap(),
    )
    .unwrap();
    for _ in 0..2 {
        install_hook_into(&dir, &config, "codex", HookLayout::Nested { timeout: 5 }).unwrap();
    }
    let value: Value = serde_json::from_str(&fs::read_to_string(&config).unwrap()).unwrap();
    // The trusted entry is untouched; prompt/stop events track later permission changes.
    assert_eq!(value["hooks"]["SessionStart"].as_array().unwrap().len(), 1);
    assert_eq!(
        value["hooks"]["SessionStart"][0]["hooks"][0]["command"],
        imported
    );
    for event in ["UserPromptSubmit", "Stop"] {
        let entries = value["hooks"][event].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .ends_with(" codex"));
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn gemini_session_hook_follows_gemini_cli_home() {
    use crate::agent_integrations::hook_targets;
    let home = std::env::temp_dir().join("home");
    let home = home.as_path();
    let work = std::env::temp_dir().join("work-gemini");
    let custom = |name: &str| (name == "GEMINI_CLI_HOME").then(|| work.clone().into_os_string());
    let gemini = |env: crate::agent_integrations::EnvLookup| {
        hook_targets(home, env)
            .into_iter()
            .find(|target| target.2 == "gemini")
            .unwrap()
            .0
    };
    assert_eq!(gemini(&custom), work.join(".gemini"));
    assert_eq!(gemini(&|_| None), home.join(".gemini"));
}

#[test]
fn copilot_and_gemini_hooks_use_their_own_formats_and_units() {
    use crate::agent_integrations::{install_hook_into, HookLayout};
    let dir = std::env::temp_dir().join(format!("cairngorm-copilot-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let copilot = dir.join("hooks/cairngorm.json");
    install_hook_into(&dir, &copilot, "copilot", HookLayout::Copilot).unwrap();
    let value: Value = serde_json::from_str(&fs::read_to_string(&copilot).unwrap()).unwrap();
    assert_eq!(value["version"], 1);
    let shell = if cfg!(windows) { "powershell" } else { "bash" };
    for event in ["sessionStart", "userPromptSubmitted"] {
        let entry = &value["hooks"][event][0];
        assert_eq!(entry["type"], "command");
        assert_eq!(entry["timeoutSec"], 10);
        assert!(entry[shell].as_str().unwrap().ends_with(" copilot"));
    }

    let gemini = dir.join("settings.json");
    install_hook_into(
        &dir,
        &gemini,
        "gemini",
        HookLayout::Nested { timeout: 5000 },
    )
    .unwrap();
    let value: Value = serde_json::from_str(&fs::read_to_string(&gemini).unwrap()).unwrap();
    assert_eq!(
        value["hooks"]["SessionStart"][0]["hooks"][0]["timeout"],
        5000
    );
    fs::remove_dir_all(dir).unwrap();
}
