use super::{calls, mcp};
use serde_json::{json, Value};

#[path = "plugin_contract_fixture.rs"]
mod fixture;

#[test]
fn open_and_pending_views_survive_more_than_64_successive_calls() {
    let (first_id, first) = calls::start(
        "retention",
        Some("retention-terminal".into()),
        None,
        json!({}),
    );
    calls::view_event(&first, "opened", Value::Null).unwrap();
    calls::view_event(&first, "input", Value::Null).unwrap();
    calls::complete(&first);
    let (pending_id, _) = calls::start(
        "retention",
        Some("retention-pending".into()),
        None,
        json!({}),
    );
    for _ in 0..80 {
        let (_, later) = calls::start(
            "retention",
            Some("retention-terminal".into()),
            None,
            json!({}),
        );
        calls::view_event(&later, "released", Value::Null).unwrap();
        calls::complete(&later);
    }
    assert!(calls::get(&first_id).is_some());
    assert!(calls::get(&pending_id).is_some());
    calls::view_event(&first, "closed", Value::Null).unwrap();
    calls::view_event(&first, "opened", Value::Null).unwrap();
    calls::view_event(&first, "context", json!({"content":[]})).unwrap();
    assert!(calls::get(&first_id).is_some());
    calls::release_terminal("retention-terminal");
    calls::release_terminal("retention-pending");
    assert!(calls::get(&first_id).is_none());
    assert!(calls::get(&pending_id).is_none());
}

#[test]
fn unknown_view_tool_refreshes_inventory_once_without_replaying_a_call() {
    let server = fixture::Server::new("inventory-refresh");
    assert_eq!(server.plugin.id, "inventory-refresh");
    assert!(server.upstream.tool("draw").is_ok());
    server
        .upstream
        .request(
            "tools/call",
            json!({"name":"draw", "arguments":{"label":"ready"}}),
            mcp::TOOL_TIMEOUT,
        )
        .unwrap();
    let callback = server.upstream.view_tool("_exec_callback").unwrap();
    assert!(mcp::visible_to(&callback, "app"));
    assert!(!mcp::visible_to(&callback, "model"));
    let log = server.messages.lock().unwrap();
    assert_eq!(
        log.iter().filter(|m| m["method"] == "tools/list").count(),
        2
    );
    assert_eq!(
        log.iter().filter(|m| m["method"] == "tools/call").count(),
        1,
        "inventory refresh must never replay mutation"
    );
}

#[test]
fn refreshing_a_view_keeps_the_existing_session_and_reads_fresh_content() {
    let server = fixture::Server::new("view-refresh");
    let uri = "ui://canvas/main";
    assert_eq!(
        server.upstream.view(uri).unwrap(),
        server.upstream.view(uri).unwrap()
    );
    server
        .upstream
        .refresh_view(uri, mcp::TOOL_TIMEOUT)
        .unwrap();
    let log = server.messages.lock().unwrap();
    assert_eq!(
        log.iter().filter(|m| m["method"] == "initialize").count(),
        1
    );
    assert_eq!(
        log.iter()
            .filter(|m| m["method"] == "resources/read")
            .count(),
        2
    );
}

#[test]
fn failed_refresh_keeps_cached_content_and_only_successful_tools_invalidate_it() {
    let server = fixture::Server::new("failed-view-refresh");
    let uri = "ui://canvas/fail-after-first";
    let original = server.upstream.view(uri).unwrap();
    server.upstream.tool("lookup").unwrap();
    server
        .upstream
        .request(
            "tools/call",
            json!({"name":"lookup", "arguments":{}}),
            mcp::TOOL_TIMEOUT,
        )
        .unwrap();
    assert_eq!(
        server.upstream.view(uri).unwrap(),
        original,
        "read-only calls retain cached views"
    );
    assert!(server
        .upstream
        .refresh_view(uri, mcp::TOOL_TIMEOUT)
        .is_err());
    assert_eq!(server.upstream.view(uri).unwrap(), original);
    server
        .upstream
        .request(
            "tools/call",
            json!({"name":"fail", "arguments":{}}),
            mcp::TOOL_TIMEOUT,
        )
        .unwrap();
    assert_eq!(server.upstream.view(uri).unwrap(), original);
    server
        .upstream
        .request(
            "tools/call",
            json!({"name":"draw", "arguments":{"label":"Saved edit"}}),
            mcp::TOOL_TIMEOUT,
        )
        .unwrap();
    assert!(
        server.upstream.view(uri).is_err(),
        "successful mutation invalidates the stale cached view"
    );
    let fresh = server.upstream.view("ui://canvas/main").unwrap();
    assert!(fresh["text"].as_str().unwrap().contains("Saved edit"));
}
