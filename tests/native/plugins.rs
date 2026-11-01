use super::{callers, calls, config_edit, mcp, upstream};
use crate::integration_config::clean_jsonc;
use serde_json::{json, Value};

fn servers(text: &str, parent: &str) -> Value {
    serde_json::from_str::<Value>(&clean_jsonc(text)).unwrap()[parent].clone()
}

#[test]
fn json_registration_preserves_user_config_and_is_idempotent() {
    let entry = json!({ "command": "node", "args": ["C:/x/mcp-bridge.cjs"] });
    for text in [
        "",
        "{}",
        "{ /* keep */ \"theme\": \"dark\", }",
        "{\"mcpServers\": {}}",
        "{\"nested\": {\"mcpServers\": {}}, \"mcpServers\": {\"other\": {\"command\": \"x\"}}}",
    ] {
        let updated = config_edit::add_json_server(text, "mcpServers", &entry).unwrap();
        let list = servers(&updated, "mcpServers");
        assert_eq!(list["cairngorm"], entry, "{text}");
        assert!(config_edit::json_server(&updated, "mcpServers").is_some());
        assert_eq!(
            config_edit::add_json_server(&updated, "mcpServers", &entry).unwrap(),
            updated
        );
        if text.contains("other") {
            assert_eq!(list["other"]["command"], "x");
            assert!(updated.contains("\"nested\": {\"mcpServers\": {}}"));
        }
        if text.contains("keep") {
            assert!(updated.contains("/* keep */"));
        }
    }
}

#[test]
fn json_registration_keeps_a_customized_entry_and_rejects_bad_shapes() {
    let mine = "{\"mcp\": {\"cairngorm\": {\"enabled\": false}}}";
    assert_eq!(
        config_edit::add_json_server(mine, "mcp", &json!({})).unwrap(),
        mine
    );
    assert!(config_edit::add_json_server("{\"mcp\": []}", "mcp", &json!({})).is_err());
    assert!(config_edit::add_json_server("not json", "mcp", &json!({})).is_err());
}

#[test]
fn codex_table_is_appended_once_with_escaped_paths() {
    let text = "model = \"gpt\"";
    let updated = config_edit::add_toml_server(text, "node", "C:/a \"b\"/bridge.cjs").unwrap();
    assert!(updated.starts_with("model = \"gpt\"\n"));
    assert!(updated.contains("[mcp_servers.cairngorm]\ncommand = \"node\"\n"));
    assert!(updated.contains("args = [\"C:/a \\\"b\\\"/bridge.cjs\"]"));
    assert_eq!(
        config_edit::add_toml_server(&updated, "node", "y").unwrap(),
        updated
    );
    // Other spellings of an existing entry are recognized, not duplicated.
    let quoted = "[mcp_servers.\"cairngorm\"]
command = \"node\"
";
    assert_eq!(
        config_edit::add_toml_server(quoted, "node", "y").unwrap(),
        quoted
    );
    // An inline server map cannot take a new table: refuse instead of corrupting it.
    let inline = "mcp_servers = { other = { command = \"x\" } }
";
    assert!(config_edit::add_toml_server(inline, "node", "y").is_err());
    assert!(config_edit::add_toml_server("not = [valid", "node", "y").is_err());
}

#[test]
fn only_entries_running_this_bridge_count_as_ours() {
    let bridge = "C:/Users/me/AppData/Roaming/app/plugins/mcp-bridge.cjs";
    let ours = json!({ "command": "node", "args": [bridge] });
    let other = json!({ "command": "node", "args": ["D:/other/plugins/mcp-bridge.cjs"] });
    assert!(config_edit::runs_bridge(&ours, bridge));
    assert!(config_edit::runs_bridge(
        &json!({"command": ["node", bridge]}),
        bridge
    ));
    assert!(!config_edit::runs_bridge(&other, bridge));
}

#[test]
fn view_policy_allows_declared_origins_only() {
    let meta = json!({ "csp": {
        "resourceDomains": ["https://cdn.example.com", "blob:", "https:", "'unsafe-hashes'", "https://a.com; script-src *", "https://*", "https://*.com", "https://*.cdn.example.org"],
        "connectDomains": ["https://api.example.com", "http://insecure.example.com"],
    }});
    let policy = mcp::content_security_policy(&meta);
    assert!(policy.contains(
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://cdn.example.com blob:"
    ));
    assert!(policy.contains("connect-src blob: data: https://api.example.com;"));
    assert!(!policy.contains("insecure"));
    assert!(!policy.contains("unsafe-hashes"));
    assert!(!policy.contains("script-src *"));
    assert!(policy.contains("https://*.cdn.example.org"));
    assert!(!policy.contains("https://* ") && !policy.contains("https://*.com"));
    assert!(policy.contains("frame-src 'none'"));
    assert!(policy.contains("object-src 'none'"));
    let default = mcp::content_security_policy(&Value::Null);
    assert!(default.contains("connect-src blob: data:;"));
}

#[test]
fn tool_metadata_controls_visibility_and_views() {
    let app_only = json!({ "_meta": { "ui": { "visibility": ["app"] } } });
    assert!(!mcp::visible_to(&app_only, "model"));
    assert!(mcp::visible_to(&app_only, "app"));
    assert!(mcp::visible_to(&json!({}), "model"));
    let legacy = json!({ "_meta": { "ui/resourceUri": "ui://canvas/app.html" } });
    assert_eq!(mcp::view_uri(&legacy), Some("ui://canvas/app.html"));
    let foreign = json!({ "_meta": { "ui": { "resourceUri": "https://evil.example/app.html" } } });
    assert_eq!(mcp::view_uri(&foreign), None);
}

#[test]
fn responses_are_matched_by_id_in_event_streams() {
    let stream = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n\
                  event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\"result\":{\"ok\":true}}\n\n";
    let message = upstream::response_message(stream, true, &json!(7)).unwrap();
    assert_eq!(message["result"]["ok"], true);
    assert!(upstream::response_message(stream, true, &json!(8)).is_none());
    let plain = upstream::response_message("{\"id\":1,\"result\":{}}", false, &json!(1));
    assert!(plain.is_some());
}

#[test]
fn view_reports_are_appended_to_the_tool_result() {
    let result = json!({ "content": [{ "type": "text", "text": "Rendering" }], "structuredContent": { "canvasId": "c1" } });
    let context = json!({ "content": [{ "type": "text", "text": "Code executed." }], "structuredContent": { "shapes": [] } });
    let (_, call) = calls::start("tldraw", Some("term-compose".into()), None, json!({}));
    calls::view_event(&call, "opened", Value::Null).unwrap();
    calls::view_event(
        &call,
        "context",
        json!({ "content": [{ "type": "text", "text": "restored" }] }),
    )
    .unwrap();
    calls::view_event(&call, "input", Value::Null).unwrap();
    calls::view_event(&call, "context", context.clone()).unwrap();
    let settled = calls::settle(&call);
    let composed = calls::compose(result, None, Some(settled), "tldraw", false);
    let blocks = composed["content"].as_array().unwrap();
    assert_eq!(blocks.len(), 2);
    let report = blocks[1]["text"].as_str().unwrap();
    assert!(report.contains("Code executed.") && report.contains("{\"shapes\":[]}"));
    assert!(
        !report.contains("restored"),
        "reports before the input are restored state"
    );
    // Agents that prefer structuredContent would otherwise never see the report.
    assert!(composed.get("structuredContent").is_none());
    let typed = calls::compose(
        json!({ "content": [], "structuredContent": { "canvasId": "c1" } }),
        Some(json!({ "content": [{ "type": "text", "text": "edit" }] })),
        None,
        "tldraw",
        true,
    );
    assert_eq!(typed["structuredContent"]["canvasId"], "c1");
    // The delivered report is not repeated on the next call.
    assert!(calls::take_pending("tldraw", Some("term-compose")).is_none());
}

#[test]
fn later_user_edits_reach_the_next_call_once() {
    let (_, call) = calls::start("tldraw", Some("term-edits".into()), None, json!({}));
    calls::view_event(&call, "input", Value::Null).unwrap();
    calls::view_event(
        &call,
        "context",
        json!({ "content": [{ "type": "text", "text": "user moved a box" }] }),
    )
    .unwrap();
    let earlier = calls::take_pending("tldraw", Some("term-edits"));
    let composed = calls::compose(json!({ "content": [] }), earlier, None, "tldraw", false);
    assert!(composed["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("user moved a box"));
    assert!(calls::take_pending("tldraw", Some("term-edits")).is_none());
}

#[test]
fn a_view_that_never_opens_is_reported() {
    let (_, call) = calls::start("tldraw", None, None, json!({}));
    calls::view_event(&call, "closed", Value::Null).unwrap();
    let settled = calls::settle(&call);
    assert!(!settled.opened);
    let composed = calls::compose(json!({}), None, Some(settled), "tldraw", false);
    assert!(composed["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("not on screen"));
}

#[test]
fn large_reports_are_truncated() {
    let big = json!({ "content": [{ "type": "text", "text": "x".repeat(40_000) }] });
    let text = calls::render(&big);
    assert!(text.len() < 31_000 && text.ends_with("(truncated)"));
}

#[test]
fn view_host_and_layout_css_are_appended_after_the_document() {
    // A closing tag inside an inline script must not be mistaken for the real one.
    let html = "<html><head><script>let s = \"</head>\";</script></head><body></body></html>";
    let served = super::gateway::with_view_host(html, "b{}");
    assert!(served.starts_with(html));
    assert!(served.contains("cairngorm/context-menu"));
    assert!(served.ends_with("<style data-cairngorm>b{}</style>"));
    let plain = super::gateway::with_view_host(html, "");
    assert!(plain.starts_with(html));
    assert!(plain.contains("cairngorm/context-menu"));
    assert!(!plain.contains("<style"));
}

#[test]
fn a_mounted_view_does_not_expire_after_64_new_calls() {
    let (id, first) = calls::start(
        "tldraw",
        Some("mounted-retention-test".into()),
        None,
        json!({}),
    );
    calls::view_event(&first, "opened", Value::Null).unwrap();
    for _ in 0..80 {
        let (_, next) = calls::start(
            "tldraw",
            Some("mounted-retention-test".into()),
            None,
            json!({}),
        );
        calls::view_event(&next, "closed", Value::Null).unwrap();
    }
    assert!(
        calls::get(&id).is_some(),
        "a mounted canvas must still accept callbacks"
    );
    calls::release_terminal("mounted-retention-test");
}

#[test]
fn the_handshake_names_the_agent() {
    // Real clientInfo names sent by agent CLIs.
    assert_eq!(callers::agent_in("claude-code/2.1.4"), Some("claude"));
    assert_eq!(callers::agent_in("codex-mcp-client/0.46.0"), Some("codex"));
    assert_eq!(callers::agent_in("gemini-cli-mcp-client/"), Some("gemini"));
    assert_eq!(callers::agent_in("opencode/1.0"), Some("opencode"));
    assert_eq!(callers::agent_in("factory-droid/0.2"), Some("droid"));
    assert_eq!(callers::agent_in("GitHub Copilot CLI/1"), Some("copilot"));
    // Process names and command lines work the same way.
    assert_eq!(
        callers::agent_in(r"node.exe C:\npm\node_modules\@anthropic-ai\claude-code\cli.js"),
        Some("claude")
    );
    assert_eq!(callers::agent_in("node mcp-bridge.cjs"), None);
    assert_eq!(callers::agent_name("codex"), Some("Codex"));
}

#[test]
fn an_agent_outside_cairngorm_terminals_is_named_but_not_counted_as_active() {
    let caller = callers::identify(Some("cursor-agent/1"), Some("no-such-terminal"), None);
    assert_eq!(caller.terminal, None);
    assert_eq!(caller.agent, Some("cursor"));
    assert!(!callers::last_seen().contains_key("cursor"));
}

#[test]
fn processes_are_recognised_by_program_not_by_model_names() {
    let args = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let of = |name: &str, exe: &str, cmd: &[&str]| callers::agent_of_process(name, exe, &args(cmd));
    assert_eq!(
        of("claude.exe", r"C:\bin\claude.exe", &["claude"]),
        Some("claude")
    );
    assert_eq!(
        of(
            "node.exe",
            r"C:\node\node.exe",
            &[
                "node",
                "--no-warnings",
                r"C:\npm\@anthropic-ai\claude-code\cli.js"
            ]
        ),
        Some("claude")
    );
    assert_eq!(
        of("codex-x86_64-pc-windows-msvc.exe", "", &[]),
        Some("codex")
    );
    assert_eq!(
        of("cursor-agent", "/usr/bin/cursor-agent", &[]),
        Some("cursor")
    );
    // A Claude model on another agent's command line does not make it Claude Code.
    assert_eq!(
        of(
            "opencode.exe",
            r"C:\bin\opencode.exe",
            &["opencode", "-m", "anthropic/claude-sonnet-4-5"]
        ),
        Some("opencode")
    );
    assert_eq!(
        of("node.exe", "", &["node", "app.js", "--model", "claude"]),
        None
    );
    // Each argv item is already one value, even when executable/package paths contain spaces.
    assert_eq!(
        of(
            "node.exe",
            r"C:\Program Files\nodejs\node.exe",
            &[
                r"C:\Program Files\nodejs\node.exe",
                "--no-warnings",
                r"C:\Users\User With Spaces\npm\node_modules\@anthropic-ai\claude-code\cli.js",
            ]
        ),
        Some("claude")
    );
    for cmd in [
        vec!["node", r"C:\Users\claude\My Project\app.js"],
        vec!["node", r"C:\Users\codex\My Project\app.js"],
        vec!["node", "app.js", "claude"],
        vec![
            "node",
            "app.js",
            "--file",
            r"C:\Projects\claude-code\notes.md",
        ],
        vec![
            "node",
            "--require",
            r"C:\Projects\claude\setup.js",
            "app.js",
        ],
        vec!["node", "-e", "claude"],
        vec![
            "node",
            "-econsole.log('ready')",
            r"C:\npm\@anthropic-ai\claude-code\cli.js",
        ],
        vec![
            "node",
            "--title",
            r"C:\npm\@anthropic-ai\claude-code\cli.js",
            "app.js",
        ],
    ] {
        assert_eq!(
            of("node.exe", r"C:\Program Files\nodejs\node.exe", &cmd),
            None,
            "{cmd:?}"
        );
    }
    assert_eq!(
        of(
            "NODE.EXE",
            r"C:\Program Files\Node\NODE.EXE",
            &["node", r"C:\NPM\@Anthropic-AI\Claude-Code\CLI.JS"]
        ),
        Some("claude")
    );
    assert_eq!(of("python.exe", "", &["python", "app.py", "claude"]), None);
    assert_eq!(
        of("node", "/usr/bin/node", &["node", "/usr/local/bin/claude"]),
        Some("claude")
    );
    assert_eq!(
        of(
            "node",
            "/usr/bin/node",
            &["node", "/home/User With Spaces/.local/bin/pi"]
        ),
        Some("pi")
    );
    for runtime in ["bun", "deno"] {
        assert_eq!(
            of(
                runtime,
                "",
                &[
                    runtime,
                    "run",
                    r"C:\npm\node_modules\@google\gemini-cli\dist\index.js",
                    "--model",
                    "claude"
                ]
            ),
            Some("gemini")
        );
        assert_eq!(
            of(
                runtime,
                "",
                &[
                    runtime,
                    "run",
                    "app.js",
                    r"C:\npm\node_modules\@google\gemini-cli\dist\index.js"
                ]
            ),
            None
        );
    }
    // Lookalike words are not agents.
    assert_eq!(
        of("node.exe", r"C:\Users\factory\android\node.exe", &[]),
        None
    );
}
