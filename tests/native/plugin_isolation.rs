use super::{
    mcp,
    scope::{self, view_origin, Upstreams},
};
use serde_json::json;
use std::sync::Arc;

#[path = "plugin_contract_fixture.rs"]
mod fixture;

#[test]
fn project_plugin_origins_do_not_share_browser_storage() {
    let gateway = "http://127.0.0.1:32123";
    let a = view_origin(gateway, "tldraw", "project-a-terminal");
    let b = view_origin(gateway, "tldraw", "project-b-terminal");
    let other = view_origin(gateway, "excalidraw", "project-a-terminal");
    assert_ne!(a, b, "different projects must not share a browser origin");
    assert_ne!(
        a, other,
        "different plugins must not share a browser origin"
    );
    assert_ne!(a, gateway, "plugin storage must not use the gateway origin");
    assert_eq!(a, view_origin(gateway, "tldraw", "project-a-terminal"));
}

#[test]
fn project_plugin_sessions_are_isolated_and_reused_on_return() {
    let server = fixture::Server::new("isolated-canvas");
    let upstreams = Upstreams::default();
    let a = upstreams.get(server.plugin, "project-a-terminal");
    let b = upstreams.get(server.plugin, "project-b-terminal");
    assert!(
        !Arc::ptr_eq(&a, &b),
        "projects must not share a plugin session"
    );
    assert!(Arc::ptr_eq(
        &a,
        &upstreams.get(server.plugin, "project-a-terminal")
    ));
    let request = |upstream: &super::upstream::Upstream, name, label| {
        upstream
            .request(
                "tools/call",
                json!({"name":name, "arguments":{"label":label}}),
                mcp::TOOL_TIMEOUT,
            )
            .unwrap()
    };
    request(&a, "draw", "Diagram A");
    request(&b, "draw", "Diagram B");
    assert_eq!(
        request(&a, "lookup", "")["structuredContent"]["label"],
        "Diagram A"
    );
    assert_eq!(
        request(&b, "lookup", "")["structuredContent"]["label"],
        "Diagram B"
    );
    let initialized = || {
        server
            .messages
            .lock()
            .unwrap()
            .iter()
            .filter(|message| message["method"] == "initialize")
            .count()
    };
    assert_eq!(initialized(), 2);
    server.upstream.instructions();
    assert_eq!(initialized(), 3);
    upstreams.reset(server.plugin.id);
    a.instructions();
    b.instructions();
    assert_eq!(
        initialized(),
        5,
        "sign-out must reset every terminal session"
    );
}

#[test]
fn scoped_view_hosts_and_ipc_guards_reject_other_origins() {
    let gateway = "http://127.0.0.1:32123";
    let origin = view_origin(gateway, "tldraw", "terminal-a");
    let host = origin.strip_prefix("http://");
    assert!(scope::matches_view_host(
        gateway,
        host,
        "tldraw",
        "terminal-a"
    ));
    assert!(!scope::matches_view_host(
        gateway,
        host,
        "tldraw",
        "terminal-b"
    ));
    assert!(!scope::matches_view_host(
        gateway,
        host,
        "mermaid",
        "terminal-a"
    ));
    assert!(!scope::matches_view_host(
        gateway,
        None,
        "tldraw",
        "terminal-a"
    ));
    assert!(scope::is_view_origin(gateway, &origin));
    assert!(scope::is_view_origin(gateway, &format!("{origin}/")));
    assert!(scope::is_view_origin(gateway, gateway));
    for invalid in [
        origin.replace(":32123", ":32124"),
        format!("{origin}.evil.example"),
        origin.replace(".localhost:", ".localhost.evil.example:"),
        "http://p-not-a-scope.localhost:32123".to_string(),
    ] {
        assert!(!scope::is_view_origin(gateway, &invalid), "{invalid}");
    }
}

#[test]
#[ignore = "requires Playwright Chromium"]
fn browser_storage_stays_with_its_project_after_switching() {
    let gateway = "http://127.0.0.1:32123";
    let fixture = json!({
        "origins": [
            view_origin(gateway, "tldraw", "project-a-terminal"),
            view_origin(gateway, "tldraw", "project-b-terminal"),
            view_origin(gateway, "excalidraw", "project-a-terminal"),
        ],
        "policy": mcp::content_security_policy(&json!({})),
    });
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let output = std::process::Command::new("node")
        .arg(root.join("node_modules/@playwright/test/cli.js"))
        .args([
            "test",
            "-c",
            "tests/playwright.isolation.config.ts",
            "plugin-isolation.spec.ts",
        ])
        .env("CAIRNGORM_PLUGIN_ISOLATION", fixture.to_string())
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
