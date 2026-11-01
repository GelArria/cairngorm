use super::*;
use std::cell::RefCell;

fn navigate(label: &str, destination: &str, app_url: &str) -> (bool, Vec<String>) {
    let opened = RefCell::new(Vec::new());
    let allowed = handle_navigation(
        label,
        &Url::parse(destination).unwrap(),
        &Url::parse(app_url).unwrap(),
        |url| opened.borrow_mut().push(url.to_string()),
    );
    (allowed, opened.into_inner())
}

#[test]
fn a_pdf_link_cannot_replace_main_or_detached_application_views() {
    for label in ["main", "detached-t1", "detached-doc-t2"] {
        let (allowed, opened) = navigate(
            label,
            "https://apps.apple.com/app/example",
            "http://tauri.localhost/",
        );
        assert!(!allowed, "external navigation replaced {label}");
        assert_eq!(opened, ["https://apps.apple.com/app/example"]);
    }
}

#[test]
fn internal_navigation_and_detached_query_payloads_stay_in_the_app() {
    for origin in [
        "tauri://localhost/",
        "http://tauri.localhost/",
        "https://tauri.localhost/",
        "http://localhost:1420/",
    ] {
        let (allowed, opened) = navigate("main", &format!("{origin}?document=test#page"), origin);
        assert!(allowed, "blocked {origin}");
        assert!(opened.is_empty());
    }
}

#[test]
fn browser_previews_keep_their_own_navigation_policy() {
    let (allowed, opened) = navigate(
        "test-preview-main-123",
        "https://example.com/",
        "http://tauri.localhost/",
    );
    assert!(allowed);
    assert!(opened.is_empty());
}

#[test]
fn privileged_schemes_credentials_and_oversized_links_never_leave_the_app() {
    for destination in [
        "javascript:alert(1)",
        "file:///C:/secret",
        "data:text/html,test",
        "blob:http://tauri.localhost/id",
        "tauri://foreign-host/",
        "https://user:password@example.com/",
        "http://user@tauri.localhost/",
        "ms-settings:privacy",
        &format!("https://example.com/{}", "x".repeat(8192)),
    ] {
        let (allowed, opened) = navigate("main", destination, "http://tauri.localhost/");
        assert!(!allowed, "allowed unsafe navigation");
        assert!(opened.is_empty(), "opened unsafe destination");
    }
}

#[test]
fn lookalike_hosts_and_other_local_ports_are_not_application_origins() {
    for destination in [
        "http://tauri.localhost.evil.test/",
        "http://tauri.localhost:8080/",
        "https://tauri.localhost/",
        "http://localhost:3000/",
    ] {
        let (allowed, opened) = navigate("main", destination, "http://tauri.localhost/");
        assert!(!allowed);
        assert_eq!(opened, [destination]);
    }
}
