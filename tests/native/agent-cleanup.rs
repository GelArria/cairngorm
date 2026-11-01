use super::*;
use crate::agent_integrations::install_hook_into;
use crate::integration_config::{add_plugin, clean_jsonc};
use std::path::PathBuf;

/// A fresh folder, removed when the test ends.
struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("cairngorm-cleanup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn json(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn removing_session_hooks_keeps_the_users_hooks_and_settings() {
    let dir = TempDir::new();
    let settings = dir.0.join("settings.json");
    fs::write(
        &settings,
        r#"{"model":"keep","hooks":{"SessionStart":[{"hooks":[{"command":"my-hook"}]}],"Notification":[]}}"#,
    )
    .unwrap();
    let layout = HookLayout::Nested { timeout: 10 };
    install_hook_into(&dir.0, &settings, "claude", layout).unwrap();
    assert!(fs::read_to_string(&settings).unwrap().contains(SCRIPT));
    remove_hooks(&settings, layout).unwrap();
    let value = json(&settings);
    assert_eq!(value["model"], "keep");
    assert_eq!(
        value["hooks"]["SessionStart"],
        serde_json::json!([{"hooks":[{"command":"my-hook"}]}])
    );
    // Events Cairngorm added are gone; the user's own empty list stays.
    assert!(value["hooks"].get("Stop").is_none());
    assert_eq!(value["hooks"]["Notification"], serde_json::json!([]));
    let after = fs::read_to_string(&settings).unwrap();
    remove_hooks(&settings, layout).unwrap();
    assert_eq!(fs::read_to_string(&settings).unwrap(), after, "idempotent");
}

#[test]
fn removing_flat_hooks_and_an_absent_config_is_safe() {
    let dir = TempDir::new();
    let cursor = dir.0.join("hooks.json");
    fs::write(
        &cursor,
        r#"{"version":1,"hooks":{"stop":[{"command":"user-stop"}]}}"#,
    )
    .unwrap();
    install_hook_into(&dir.0, &cursor, "cursor", HookLayout::Cursor).unwrap();
    remove_hooks(&cursor, HookLayout::Cursor).unwrap();
    let value = json(&cursor);
    assert_eq!(value["hooks"]["stop"][0]["command"], "user-stop");
    assert!(value["hooks"].get("sessionStart").is_none());
    assert!(remove_hooks(&dir.0.join("missing.json"), HookLayout::Cursor).is_ok());
    fs::write(&cursor, "{not json").unwrap();
    assert!(
        remove_hooks(&cursor, HookLayout::Cursor).is_err(),
        "an unreadable config is reported, never rewritten"
    );
    assert_eq!(fs::read_to_string(&cursor).unwrap(), "{not json");
}

#[test]
fn removing_the_opencode_plugin_keeps_comments_and_other_plugins() {
    let dir = TempDir::new();
    let tui = dir.0.join("tui.jsonc");
    let original = "{\n  // mine\n  \"plugin\": [\"keep\", /* note */ \"other\"]\n}";
    let added = add_plugin(original, "plugin", "./cairngorm-session.js").unwrap();
    fs::write(&tui, &added).unwrap();
    fs::write(dir.0.join("cairngorm-session.js"), "x").unwrap();
    fs::create_dir_all(dir.0.join("cairngorm-session")).unwrap();
    fs::write(dir.0.join("cairngorm-session/tui.js"), "x").unwrap();
    remove_opencode(&dir.0).unwrap();
    let text = fs::read_to_string(&tui).unwrap();
    assert!(text.contains("// mine") && text.contains("/* note */"));
    let value: Value = serde_json::from_str(&clean_jsonc(&text)).unwrap();
    assert_eq!(value["plugin"], serde_json::json!(["keep", "other"]));
    assert!(!dir.0.join("cairngorm-session.js").exists());
    assert!(!dir.0.join("cairngorm-session").exists());
}

#[test]
fn remove_plugin_handles_every_position_and_leaves_absent_lists_alone() {
    let item = "\"ours\"";
    for (text, expected) in [
        (format!("{{\"plugin\":[{item}]}}"), vec![]),
        (format!("{{\"plugin\":[{item}, \"a\"]}}"), vec!["a"]),
        (format!("{{\"plugin\":[\"a\", {item}]}}"), vec!["a"]),
        (
            format!("{{\"plugin\":[\"a\",{item},\"b\",]}}"),
            vec!["a", "b"],
        ),
    ] {
        let updated = remove_plugin(&text, "plugin", "ours").unwrap();
        let value: Value = serde_json::from_str(&clean_jsonc(&updated)).unwrap();
        assert_eq!(value["plugin"], serde_json::json!(expected), "{text}");
    }
    let untouched = "{\"name\":\"ours\",\"plugin\":[\"a\"]}";
    assert_eq!(
        remove_plugin(untouched, "plugin", "ours").unwrap(),
        untouched
    );
}

#[test]
fn the_removed_marker_is_recorded_and_cleared() {
    let home = TempDir::new();
    assert!(!removed(&home.0));
    set_removed(&home.0, true).unwrap();
    assert!(removed(&home.0));
    set_removed(&home.0, false).unwrap();
    assert!(!removed(&home.0));
    set_removed(&home.0, false).unwrap();
}

#[test]
fn uninstalling_the_status_line_restores_the_previous_command() {
    use crate::claude_statusline::{install, uninstall};
    let dir = TempDir::new();
    let settings = dir.0.join("settings.json");
    fs::write(
        &settings,
        r#"{"model":"opus","statusLine":{"type":"command","command":"my-line","padding":1}}"#,
    )
    .unwrap();
    install(&dir.0).unwrap();
    fs::write(dir.0.join("cairngorm-usage.json"), "{}").unwrap();
    uninstall(&dir.0).unwrap();
    let value = json(&settings);
    assert_eq!(value["model"], "opus");
    assert_eq!(value["statusLine"]["command"], "my-line");
    assert_eq!(value["statusLine"]["padding"], 1);
    assert!(!dir.0.join("hooks/cairngorm-statusline.chain").exists());
    assert!(!dir.0.join("cairngorm-usage.json").exists());

    // Without a previous status line, the setting is removed altogether.
    fs::write(&settings, r#"{"model":"opus"}"#).unwrap();
    install(&dir.0).unwrap();
    uninstall(&dir.0).unwrap();
    assert!(json(&settings).get("statusLine").is_none());

    // Another tool's status line is never touched.
    fs::write(&settings, r#"{"statusLine":{"command":"other"}}"#).unwrap();
    uninstall(&dir.0).unwrap();
    assert_eq!(json(&settings)["statusLine"]["command"], "other");
}
