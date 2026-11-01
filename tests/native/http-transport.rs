use super::{root_store, select_proxy, tls_config};
use std::collections::HashMap;

fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    move |name| map.get(name).cloned()
}

fn route(url: &str, pairs: &[(&str, &str)]) -> Option<(&'static str, String)> {
    select_proxy(url, env(pairs)).expect("valid proxy settings")
}

fn fixture(name: &str) -> String {
    format!(
        "{}/../tests/fixtures/http-transport/{name}",
        env!("CARGO_MANIFEST_DIR")
    )
}

#[test]
fn each_scheme_uses_its_own_variable_with_lowercase_first() {
    let vars = [
        ("http_proxy", "http://lower:1"),
        ("HTTP_PROXY", "http://upper:2"),
        ("HTTPS_PROXY", "secure:3"),
    ];
    assert_eq!(
        route("http://api.example/v1", &vars),
        Some(("http_proxy", "http://lower:1".into()))
    );
    assert_eq!(
        route("https://api.example/v1", &vars),
        Some(("HTTPS_PROXY", "http://secure:3".into()))
    );
    // An HTTPS request never falls back to the HTTP proxy.
    assert_eq!(
        route("https://api.example", &[("HTTP_PROXY", "http://p:1")]),
        None
    );
}

#[test]
fn all_proxy_is_the_fallback_and_empty_values_are_unset() {
    let vars = [("https_proxy", "  "), ("ALL_PROXY", "http://all:8")];
    assert_eq!(
        route("https://api.example", &vars),
        Some(("ALL_PROXY", "http://all:8".into()))
    );
    assert_eq!(route("https://api.example", &[]), None);
    assert_eq!(
        route("ws://api.example", &[("ALL_PROXY", "http://all:8")]),
        None
    );
    assert_eq!(
        route("http://api.example", &[("http_proxy", "proxy.corp")]),
        Some(("http_proxy", "http://proxy.corp:80".into()))
    );
}

#[test]
fn no_proxy_bypasses_listed_hosts_only() {
    let direct = |url: &str, list: &str| {
        route(url, &[("HTTPS_PROXY", "http://p:1"), ("NO_PROXY", list)]).is_none()
    };
    assert!(direct("https://api.example.com", "example.com"));
    assert!(direct("https://API.Example.com.", ".example.com"));
    assert!(direct("https://a.b.example.com", "other, *.example.com"));
    assert!(direct("https://example.com:8443", "example.com:443"));
    assert!(direct("https://anything", "*"));
    assert!(direct("https://127.0.0.1:9", "localhost 127.0.0.1"));
    assert!(direct("https://10.2.3.4", "10.0.0.0/8"));
    assert!(direct("https://[::1]:9", "[::1]:9"));
    assert!(direct("https://[fd00::5]", "fd00::/8"));
    assert!(!direct("https://notexample.com", "example.com"));
    assert!(!direct("https://example.com.evil", "example.com"));
    assert!(!direct("https://11.0.0.1", "10.0.0.0/8"));
    // Names are not resolved: `localhost` does not cover its address.
    assert!(!direct("https://127.0.0.1", "localhost"));
    // Lowercase no_proxy wins over NO_PROXY.
    let vars = [
        ("HTTPS_PROXY", "http://p:1"),
        ("no_proxy", "a.example"),
        ("NO_PROXY", "b.example"),
    ];
    assert!(route("https://a.example", &vars).is_none());
    assert!(route("https://b.example", &vars).is_some());
}

#[test]
fn invalid_settings_are_reported_without_their_values() {
    for value in [
        "socks5://user:hunter2@p:1",
        "https://user:hunter2@p:1",
        "http://user:hunter2@[::1]:1",
    ] {
        let error =
            select_proxy("https://api.example", env(&[("HTTPS_PROXY", value)])).expect_err(value);
        assert!(error.contains("HTTPS_PROXY"), "{error}");
        assert!(!error.contains("hunter2"), "{error}");
    }
    let error = select_proxy(
        "https://api.example",
        env(&[("HTTPS_PROXY", "http://p:1"), ("NO_PROXY", "10.0.0.0/33")]),
    )
    .expect_err("invalid range");
    assert!(error.contains("10.0.0.0/33"), "{error}");
    // Reported even when an earlier entry matches, and for bracketed ranges.
    for list in ["api.example, 10.0.0.0/33", "[fd00::]/8"] {
        let vars = env(&[("HTTPS_PROXY", "http://p:1"), ("NO_PROXY", list)]);
        assert!(select_proxy("https://api.example", vars).is_err(), "{list}");
    }
}

#[test]
fn proxy_credentials_are_decoded_for_ureq() {
    assert_eq!(
        route(
            "https://api.example",
            &[("HTTPS_PROXY", "http://me%40corp:p%3Aw@p:1")]
        ),
        Some(("HTTPS_PROXY", "http://me@corp:p:w@p:1".into()))
    );
    let proxy = ureq::Proxy::new("http://me@corp:p:w@p:1");
    assert!(proxy.is_ok(), "ureq parses decoded credentials");
}

#[test]
fn extra_ca_file_is_added_or_reported() {
    assert!(tls_config(env(&[])).unwrap().is_none());
    let valid = fixture("extra-ca.pem");
    assert!(tls_config(env(&[("NODE_EXTRA_CA_CERTS", &valid)]))
        .unwrap()
        .is_some());
    // The extra root is added to the bundled ones, never in their place.
    let roots = root_store(std::path::Path::new(&valid)).unwrap();
    assert_eq!(roots.len(), webpki_roots::TLS_SERVER_ROOTS.len() + 1);
    for name in ["missing.pem", "no-certificates.pem"] {
        let path = fixture(name);
        let error = tls_config(env(&[("NODE_EXTRA_CA_CERTS", &path)]))
            .err()
            .unwrap_or_else(|| panic!("{name} must be rejected"));
        assert!(error.starts_with("NODE_EXTRA_CA_CERTS"), "{error}");
    }
}
