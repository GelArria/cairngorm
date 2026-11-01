use super::{callers::Caller, calls, catalog::PluginSpec, mcp};
use serde_json::{json, Value};
use std::sync::Mutex;

#[path = "plugin_contract_fixture.rs"]
mod fixture;

#[derive(Default)]
struct Host(Mutex<Vec<Value>>);
impl mcp::ViewHost for Host {
    fn open(&self, _: &str, plugin: &PluginSpec, call: &calls::Call, arguments: &Value, _: &Value) {
        self.0.lock().unwrap().push(json!({"plugin":plugin.id, "terminal":call.terminal, "agent":call.agent, "arguments":arguments}));
        calls::view_event(call, "opened", Value::Null).unwrap();
        calls::view_event(call, "input", Value::Null).unwrap();
        calls::view_event(
            call,
            "context",
            json!({"content":[{"type":"text", "text":"Diagram on screen"}]}),
        )
        .unwrap();
        calls::view_event(call, "closed", Value::Null).unwrap();
    }
    fn finished(&self, _: &str, outcome: &Result<Value, String>) {
        assert!(outcome.is_ok());
    }
}

#[test]
fn any_client_gets_capabilities_schemas_and_automatic_panel_opening() {
    let server = fixture::Server::new("custom-canvas");
    let plugins = [(server.plugin, server.upstream.clone())];
    let host = Host::default();
    let mut first_handshake = None;
    for client in ["Pi", "OpenCode", "My independently built CLI"] {
        let caller = Caller {
            terminal: Some(format!("terminal-{client}")),
            agent: None,
        };
        let rpc = |method, params: Value| {
            mcp::dispatch(method, &params, caller.clone(), &plugins, &host).unwrap()
        };
        let handshake = rpc(
            "initialize",
            json!({"protocolVersion":"2025-06-18", "clientInfo":{"name":client}}),
        );
        if let Some(first) = &first_handshake {
            assert_eq!(&handshake, first, "capabilities must not vary by CLI brand");
        } else {
            first_handshake = Some(handshake.clone());
        }
        assert_eq!(handshake["capabilities"]["resources"], json!({}));
        let guide = handshake["instructions"].as_str().unwrap();
        assert!(
            guide.contains("Custom Canvas (custom-canvas)")
                && guide.contains("unless the user asks for a file")
        );
        assert!(guide.contains("Use the canvas schema for this plugin only."));
        let listing = rpc("tools/list", json!({}));
        let tools = listing["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2, "app-only tools must stay private");
        assert!(tools[0]["description"]
            .as_str()
            .unwrap()
            .contains("Custom Canvas"));
        assert!(tools[0]["description"]
            .as_str()
            .unwrap()
            .contains("interactive panel"));
        assert!(tools[1]["description"]
            .as_str()
            .unwrap()
            .contains(server.plugin.description));
        assert!(!tools[1]["description"]
            .as_str()
            .unwrap()
            .contains("Opens an interactive panel"));
        assert_eq!(tools[1]["annotations"]["readOnlyHint"], true);
        assert_eq!(
            tools[0]["inputSchema"]["properties"]["label"]["type"],
            "string"
        );
        let result = rpc(
            "tools/call",
            json!({"name":"custom-canvas_draw", "arguments":{"label":"Process L"}}),
        );
        assert!(!result["isError"].as_bool().unwrap_or(false));
        assert!(result.to_string().contains("Diagram on screen"));
        let opened = host.0.lock().unwrap().last().cloned().unwrap();
        assert_eq!(opened["terminal"], caller.terminal.unwrap());
        assert_eq!(
            opened["agent"],
            Value::Null,
            "no recognized CLI brand is needed"
        );
        assert_eq!(opened["arguments"]["label"], "Process L");
    }
    assert_eq!(host.0.lock().unwrap().len(), 3);
    let caller = Caller {
        terminal: Some("plain-terminal".into()),
        agent: None,
    };
    mcp::dispatch(
        "tools/call",
        &json!({"name":"custom-canvas_lookup", "arguments":{}}),
        caller.clone(),
        &plugins,
        &host,
    )
    .unwrap();
    assert_eq!(
        host.0.lock().unwrap().len(),
        3,
        "nonvisual tools do not open panels"
    );
    assert!(mcp::dispatch(
        "tools/call",
        &json!({"name":"custom-canvas_app_only"}),
        caller.clone(),
        &plugins,
        &host
    )
    .is_err());
    assert!(mcp::dispatch(
        "tools/call",
        &json!({"name":"custom-canvas_draw"}),
        caller,
        &[],
        &host
    )
    .is_err());
    assert_eq!(
        host.0.lock().unwrap().len(),
        3,
        "hidden or disabled tools cannot open panels"
    );
}

#[test]
fn live_context_changes_with_enabled_plugins_without_network_calls_or_hidden_tools() {
    let server = fixture::Server::new("context-canvas");
    let plugins = [(server.plugin, server.upstream.clone())];
    let host = Host::default();
    let caller = Caller {
        terminal: Some("context-terminal".into()),
        agent: None,
    };
    let list = mcp::dispatch(
        "resources/list",
        &json!({}),
        caller.clone(),
        &plugins,
        &host,
    )
    .unwrap();
    let uri = list["resources"][0]["uri"].as_str().unwrap();
    assert_eq!(uri, "cairngorm://plugins");
    let read = |enabled: &[_]| {
        let result = mcp::dispatch(
            "resources/read",
            &json!({"uri":uri}),
            caller.clone(),
            enabled,
            &host,
        )
        .unwrap();
        serde_json::from_str::<Value>(result["contents"][0]["text"].as_str().unwrap()).unwrap()
    };
    let enabled = read(&plugins);
    assert_eq!(enabled["plugins"][0]["toolPrefix"], "context-canvas_");
    assert_eq!(
        enabled["plugins"][0]["description"],
        server.plugin.description
    );
    assert!(enabled["instructions"]
        .as_str()
        .unwrap()
        .contains("tools/list is authoritative"));
    assert!(read(&[])["plugins"].as_array().unwrap().is_empty());
    assert!(!read(&[]).to_string().contains("context-canvas"));
    assert_eq!(
        read(&plugins),
        enabled,
        "the same client sees a re-enabled plugin"
    );
    assert!(
        server.messages.lock().unwrap().is_empty(),
        "reading context must not initialize or invoke upstreams"
    );
    assert!(!enabled.to_string().contains(server.plugin.server_url));
    let error = mcp::dispatch(
        "resources/read",
        &json!({"uri":"file:///private"}),
        caller.clone(),
        &plugins,
        &host,
    )
    .unwrap_err();
    assert_eq!(error.0, -32002);
    assert_eq!(
        mcp::dispatch("resources/read", &json!({}), caller, &plugins, &host)
            .unwrap_err()
            .0,
        -32602
    );
}
