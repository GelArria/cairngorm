use super::*;
use serde_json::json;

#[test]
fn removes_middle_first_last_and_only_entries_keeping_format() {
    let text = "{\n  // keep me\n  \"mcpServers\": {\n    \"a\": { \"command\": \"x\" },\n    \"b\": { \"url\": \"https://b\" },\n    \"c\": { \"command\": \"y\", \"args\": [\"1\"] }\n  },\n  \"other\": 1\n}";
    let middle = remove_json(text, &["mcpServers"], "b").unwrap();
    assert!(middle.contains("// keep me"));
    assert!(middle.contains("\"a\": { \"command\": \"x\" },\n    \"c\""));
    let last = remove_json(text, &["mcpServers"], "c").unwrap();
    assert!(last.contains("\"b\": { \"url\": \"https://b\" }\n  }"));
    let first = remove_json(text, &["mcpServers"], "a").unwrap();
    assert!(first.contains("{\n    \"b\""));
    let only = remove_json("{\"mcpServers\":{\"a\":{}}}", &["mcpServers"], "a").unwrap();
    assert_eq!(only, "{\"mcpServers\":{}}");
    assert!(remove_json(text, &["mcpServers"], "missing").is_err());
}

#[test]
fn removes_nested_project_servers() {
    let text = r#"{"projects":{"C:/p":{"mcpServers":{"x":{"command":"a"},"y":{"command":"b"}}}}}"#;
    let out = remove_json(text, &["projects", "C:/p", "mcpServers"], "x").unwrap();
    assert_eq!(
        out,
        r#"{"projects":{"C:/p":{"mcpServers":{"y":{"command":"b"}}}}}"#
    );
}

#[test]
fn adds_json_servers_and_refuses_duplicates() {
    let out = add_json(
        "{\n  \"mcpServers\": {}\n}",
        "mcpServers",
        "n",
        &json!({"url": "u"}),
    )
    .unwrap();
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed["mcpServers"]["n"]["url"], "u");
    assert!(add_json(&out, "mcpServers", "n", &json!({})).is_err());
    let fresh = add_json("{ \"theme\": 1 }", "mcp", "n", &json!({"enabled": true})).unwrap();
    let parsed: Value = serde_json::from_str(&fresh).unwrap();
    assert_eq!(parsed["theme"], 1);
    assert_eq!(parsed["mcp"]["n"]["enabled"], true);
}

#[test]
fn toml_remove_drops_server_and_sub_tables_only() {
    let text = "model = \"x\"\n\n[mcp_servers.a]\ncommand = \"a\"\n\n[mcp_servers.a.env]\nK = \"v\"\n\n[mcp_servers.b]\nurl = \"https://b\"\n";
    let out = remove_toml(text, "a").unwrap();
    assert!(!out.contains("command = \"a\""));
    assert!(!out.contains("K = \"v\""));
    assert!(out.contains("[mcp_servers.b]"));
    assert!(out.contains("model = \"x\""));
    let inline = "mcp_servers = { a = { command = \"a\" } }\n";
    assert!(remove_toml(inline, "a").is_err());
}

#[test]
fn toml_add_appends_a_table() {
    let out = add_toml(
        "model = \"x\"",
        "n",
        &[("command", json!("npx")), ("args", json!(["-y", "pkg"]))],
    )
    .unwrap();
    let parsed: toml::Value = toml::from_str(&out).unwrap();
    assert_eq!(parsed["mcp_servers"]["n"]["args"][1].as_str(), Some("pkg"));
    assert!(add_toml(&out, "n", &[]).is_err());
}

#[test]
fn removal_keeps_neighbouring_comments() {
    let json = "{\n  \"mcpServers\": {\n    \"a\": { \"command\": \"x\" }, // note about a\n    \"b\": { \"command\": \"y\" }\n  }\n}";
    let out = remove_json(json, &["mcpServers"], "b").unwrap();
    assert!(out.contains("// note about a"), "{out}");
    assert!(!out.contains("\"b\""));
    let toml =
        "[mcp_servers.a]\ncommand = \"a\"\n\n# GitHub tools\n[mcp_servers.b]\ncommand = \"b\"\n";
    let out = remove_toml(toml, "a").unwrap();
    assert!(out.contains("# GitHub tools\n[mcp_servers.b]"), "{out}");
}
