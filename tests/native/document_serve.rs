use super::*;
use std::fs;

const GATEWAY: &str = "http://127.0.0.1:4321";

fn installed(id: &str) -> (std::path::PathBuf, impl Drop) {
    let scratch = install::tests::Scratch::new();
    let (source, root) = (scratch.0.join("source"), scratch.0.join("installed"));
    install::tests::write_bundle(&source, id, "1.0.0");
    let reviewed = install::inspect(&root, &source).unwrap();
    install::install(&root, &source, &reviewed.approval_hash).unwrap();
    (root, scratch)
}

/// The provider (v-) host paired with a frame origin from `view_origin`.
fn host(origin: &str) -> String {
    origin
        .strip_prefix("http://d-")
        .map(|rest| format!("v-{rest}"))
        .unwrap()
}

#[test]
fn serves_bundle_files_and_the_sdk_only_on_registered_origins() {
    let (root, _scratch) = installed("com.example.serve");
    let origin = origins::view_origin(GATEWAY, "com.example.serve", "project-a");
    assert!(origins::is_document_origin(GATEWAY, &origin));
    let host = host(&origin);
    let get = |path: &str| serve(Some(&root), GATEWAY, "GET", path, Some(&host)).unwrap();
    let entry = get("/");
    assert_eq!(entry.status, "200 OK");
    assert!(entry
        .headers
        .iter()
        .any(|(k, v)| *k == "Content-Security-Policy" && v.contains("connect-src 'self'")));
    assert_eq!(
        get("/assets/style.css").headers[0].1,
        "text/css; charset=utf-8"
    );
    assert!(String::from_utf8(get("/_cairngorm/document-sdk.js").body)
        .unwrap()
        .contains("document/initialize"));
    for bad in [
        "/../approved.json",
        "/%2e%2e/approved.json",
        "/.git/config",
        "/assets\\style.css",
        "/missing.js",
        "/a%00b",
    ] {
        assert_eq!(get(bad).status, "404 Not Found", "{bad}");
    }
    assert_eq!(
        serve(Some(&root), GATEWAY, "POST", "/", Some(&host))
            .unwrap()
            .status,
        "404 Not Found"
    );
}

#[test]
fn origins_are_scoped_by_project_and_ignore_other_hosts() {
    let (root, _scratch) = installed("com.example.scoped");
    let a = origins::view_origin(GATEWAY, "com.example.scoped", "project-a");
    let b = origins::view_origin(GATEWAY, "com.example.scoped", "project-b");
    assert_ne!(a, b);
    assert!(serve(Some(&root), GATEWAY, "GET", "/", Some("127.0.0.1:4321")).is_none());
    assert!(serve(
        Some(&root),
        GATEWAY,
        "GET",
        "/",
        Some("p-0123456789abcdef0123456789abcdef.localhost:4321")
    )
    .is_none());
    let unknown = "d-0123456789abcdef0123456789abcdef.localhost:4321";
    assert_eq!(
        serve(Some(&root), GATEWAY, "GET", "/", Some(unknown))
            .unwrap()
            .status,
        "404 Not Found"
    );
    assert!(!origins::is_document_origin(
        GATEWAY,
        "http://d-0123.localhost:4321"
    ));
    assert!(!origins::is_document_origin(
        GATEWAY,
        "http://d-0123456789abcdef0123456789abcdef.localhost:9999"
    ));
}

#[test]
fn removed_or_forgotten_providers_stop_serving() {
    let (root, _scratch) = installed("com.example.removed");
    let origin = origins::view_origin(GATEWAY, "com.example.removed", "project-c");
    let host = host(&origin);
    install::remove(&root, "com.example.removed").unwrap();
    assert_eq!(
        serve(Some(&root), GATEWAY, "GET", "/", Some(&host))
            .unwrap()
            .status,
        "404 Not Found"
    );
    origins::forget_provider("com.example.removed");
    assert_eq!(
        serve(Some(&root), GATEWAY, "GET", "/", Some(&host))
            .unwrap()
            .status,
        "404 Not Found"
    );
}

#[test]
fn request_paths_are_decoded_and_checked() {
    assert_eq!(request_path("/a%20b/c.js?x=1").as_deref(), Some("a b/c.js"));
    assert_eq!(request_path("/").as_deref(), Some(""));
    assert_eq!(request_path("relative"), None);
    assert_eq!(request_path("/a//b"), None);
    assert_eq!(request_path("/%zz"), None);
    let _ = fs::metadata("."); // keeps the import used on every platform
}

#[test]
fn html_gets_the_webrtc_guard_before_any_provider_script() {
    let (root, _scratch) = installed("com.example.guarded");
    let host = host(&origins::view_origin(
        GATEWAY,
        "com.example.guarded",
        "project-g",
    ));
    let entry = serve(Some(&root), GATEWAY, "GET", "/", Some(&host)).unwrap();
    let html = String::from_utf8(entry.body).unwrap();
    let guard = html.find("/_cairngorm/guard.js").unwrap();
    assert!(guard < html.find("main.js").unwrap(), "{html}");
    let script = serve(
        Some(&root),
        GATEWAY,
        "GET",
        "/_cairngorm/guard.js",
        Some(&host),
    )
    .unwrap();
    assert!(String::from_utf8(script.body)
        .unwrap()
        .contains("RTCPeerConnection"));
    assert_eq!(
        String::from_utf8(with_guard(b"<!DOCTYPE html><HEAD><script src=a.js></script>")).unwrap(),
        "<!DOCTYPE html><HEAD><script src=\"/_cairngorm/guard.js\"></script><script src=a.js></script>"
    );
}

#[test]
fn document_hosts_never_fall_through_to_the_gateway() {
    let answer = serve(
        None,
        GATEWAY,
        "POST",
        "/mcp",
        Some("d-0123456789abcdef0123456789abcdef.localhost:4321"),
    );
    assert_eq!(answer.unwrap().status, "404 Not Found");
    let other_port = serve(None, GATEWAY, "GET", "/catalog", Some("d-x.localhost:9999"));
    assert_eq!(other_port.unwrap().status, "404 Not Found");
    assert!(serve(None, GATEWAY, "GET", "/catalog", Some("127.0.0.1:4321")).is_none());
}

#[test]
fn the_frame_host_serves_only_the_relay_and_embeds_only_its_provider() {
    let (root, _scratch) = installed("com.example.framed");
    let origin = origins::view_origin(GATEWAY, "com.example.framed", "project-f");
    let frame = origin.strip_prefix("http://").unwrap().to_string();
    let get = |path: &str| serve(Some(&root), GATEWAY, "GET", path, Some(&frame)).unwrap();
    let page = get("/_cairngorm/frame.html?entry=index.html");
    assert_eq!(page.status, "200 OK");
    let csp = &page
        .headers
        .iter()
        .find(|(k, _)| *k == "Content-Security-Policy")
        .unwrap()
        .1;
    assert!(
        csp.contains(&format!("frame-src http://{}", host(&origin))),
        "{csp}"
    );
    assert!(!csp.contains("*"), "{csp}");
    assert!(String::from_utf8(get("/_cairngorm/frame.js").body)
        .unwrap()
        .contains("ancestorOrigins"));
    for path in [
        "/",
        "/index.html",
        "/main.js",
        "/_cairngorm/document-sdk.js",
    ] {
        assert_eq!(get(path).status, "404 Not Found", "{path}");
    }
    let provider = host(&origin);
    let frame_on_provider = serve(
        Some(&root),
        GATEWAY,
        "GET",
        "/_cairngorm/frame.html",
        Some(&provider),
    );
    assert_eq!(frame_on_provider.unwrap().status, "404 Not Found");
    assert!(origins::is_document_origin(
        GATEWAY,
        &format!("http://{provider}")
    ));
}

#[test]
fn only_the_app_may_embed_the_frame_and_only_the_frame_may_embed_the_provider() {
    let (root, _scratch) = installed("com.example.ancestors");
    let origin = origins::view_origin(GATEWAY, "com.example.ancestors", "project-x");
    let csp = |host: &str, path: &str| {
        let response = serve(Some(&root), GATEWAY, "GET", path, Some(host)).unwrap();
        response
            .headers
            .iter()
            .find(|(k, _)| *k == "Content-Security-Policy")
            .unwrap()
            .1
            .clone()
    };
    let frame = csp(
        origin.strip_prefix("http://").unwrap(),
        "/_cairngorm/frame.html",
    );
    assert!(
        frame.contains("frame-ancestors http://tauri.localhost tauri://localhost"),
        "{frame}"
    );
    for path in [
        "/",
        "/main.js",
        "/_cairngorm/document-sdk.js",
        "/_cairngorm/guard.js",
    ] {
        let provider = csp(&host(&origin), path);
        assert!(
            // Every ancestor is checked: the relay frame and the Cairngorm window.
            provider.contains(&format!(
                "frame-ancestors {origin} http://tauri.localhost tauri://localhost"
            )),
            "{path}: {provider}"
        );
    }
}
