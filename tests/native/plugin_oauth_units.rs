// Pure pieces of plugin sign-in: spec helpers, error classification, the chunked vault and
// the catalog. The end-to-end flow is in plugin_oauth.rs.
use super::{callback, catalog, oauth, oauth_token, tokens, vault};
use std::collections::HashMap;

#[test]
fn sign_ins_larger_than_a_windows_credential_are_split_and_removed_whole() {
    // A JWT-sized refresh token pushes the record past 1280 UTF-16 characters.
    let value = format!("{{\"refresh_token\":\"{}\"}}", "x".repeat(3500));
    vault::put("vault-big", &value).unwrap();
    assert_eq!(
        vault::get("vault-big").unwrap().as_deref(),
        Some(value.as_str())
    );
    // Shrinking leaves no stale parts behind; deleting removes every part.
    vault::put("vault-big", "small").unwrap();
    assert_eq!(vault::get("vault-big").unwrap().as_deref(), Some("small"));
    assert_eq!(vault::store::get("vault-big#1").unwrap(), None);
    vault::delete("vault-big");
    assert_eq!(vault::get("vault-big").unwrap(), None);
    assert_eq!(vault::store::get("vault-big#0").unwrap(), None);
}

#[test]
fn only_a_verdict_on_the_grant_signs_out() {
    assert!(oauth_token::is_revoked(400, "invalid_grant"));
    assert!(oauth_token::is_revoked(401, "invalid_client"));
    // Rate limits, timeouts and other refusals may pass: the sign-in is kept.
    assert!(!oauth_token::is_revoked(429, "invalid_grant"));
    assert!(!oauth_token::is_revoked(408, ""));
    assert!(!oauth_token::is_revoked(400, "invalid_request"));
    assert!(!oauth_token::is_revoked(503, "invalid_grant"));
}

#[test]
fn sign_in_addresses_must_be_https() {
    assert!(oauth::secure("https://auth.example.com/authorize"));
    for url in [
        "http://auth.example.com",
        "file:///C:/x",
        "javascript:alert(1)",
        "ms-settings:",
    ] {
        assert!(!oauth::secure(url), "{url}");
    }
}

#[test]
fn a_late_rejection_never_signs_out_a_newer_sign_in() {
    let tokens_of = |access: &str| oauth::Tokens {
        access_token: access.into(),
        refresh_token: Some("r".into()),
        expires_in: Some(3600),
    };
    let client = || oauth::Client {
        client_id: "c".into(),
        client_secret: None,
        auth_method: "none".into(),
    };
    let id = "late-rejection";
    tokens::save(
        id,
        client(),
        "https://t".into(),
        "https://r".into(),
        tokens_of("old"),
    )
    .unwrap();
    // The user signs in again while a request with the old token is still out.
    tokens::save(
        id,
        client(),
        "https://t".into(),
        "https://r".into(),
        tokens_of("new"),
    )
    .unwrap();
    tokens::rejected(id, "old");
    tokens::forget_rejected(id, "old");
    assert!(tokens::signed_in(id));
    assert_eq!(tokens::bearer(id, "Late").unwrap(), "new");
    tokens::rejected(id, "new");
    tokens::forget_rejected(id, "new");
    assert!(!tokens::signed_in(id));
}

#[test]
fn oauth_helpers_follow_the_specs() {
    assert_eq!(
        oauth::well_known(
            "https://auth.example.com/tenant/v1/",
            "oauth-authorization-server"
        )
        .unwrap(),
        "https://auth.example.com/.well-known/oauth-authorization-server/tenant/v1"
    );
    assert_eq!(
        oauth::challenge_metadata(
            "Bearer realm=\"x\", resource_metadata=\"https://a.example/m\", scope=\"s\""
        ),
        Some("https://a.example/m".into())
    );
    assert_eq!(oauth::encode("a b/c+é"), "a%20b%2Fc%2B%C3%A9");
    let query: HashMap<_, _> = callback::parse_query("code=a%2Fb&state=x+y&flag");
    assert_eq!(
        (
            query["code"].as_str(),
            query["state"].as_str(),
            query["flag"].as_str()
        ),
        ("a/b", "x y", "")
    );
    let (verifier, challenge) = oauth::pkce();
    assert_eq!((verifier.len(), challenge.len()), (64, 43));
}

#[test]
fn the_catalog_parses_and_lists_only_https_servers_with_logos() {
    let all = catalog::catalog();
    assert!(all.len() >= 18, "catalog failed to parse");
    let mut ids = std::collections::HashSet::new();
    for plugin in all {
        assert!(ids.insert(plugin.id), "duplicate id {}", plugin.id);
        if plugin.local_app {
            assert!(
                plugin.server_url.is_empty(),
                "local app has a remote endpoint: {}",
                plugin.id
            );
            assert_eq!(plugin.auth, catalog::Auth::None);
        } else {
            assert!(plugin.server_url.starts_with("https://"), "{}", plugin.id);
        }
        assert!(
            !plugin.category.is_empty() && !plugin.description.is_empty(),
            "{}",
            plugin.id
        );
    }
    assert_eq!(catalog::find("notion").unwrap().auth, catalog::Auth::OAuth);
    assert_eq!(catalog::find("tldraw").unwrap().auth, catalog::Auth::None);
}

/// Network check of every OAuth entry against the real services:
/// `cargo test --lib -- --ignored real_services`. Registers a throwaway client per service.
#[test]
#[ignore]
fn real_services_accept_cairngorm_as_a_client() {
    let mut failures = Vec::new();
    for plugin in catalog::catalog()
        .iter()
        .filter(|p| p.auth == catalog::Auth::OAuth)
    {
        let outcome = oauth::discover(plugin.server_url).and_then(|server| {
            let redirect = "http://127.0.0.1:53682/callback";
            let client = oauth::register(&server, redirect)?;
            let (_, challenge) = oauth::pkce();
            let url = oauth::authorize_url(&server, &client, redirect, &challenge, "state");
            let agent = ureq::AgentBuilder::new().redirects(0).build();
            match agent.get(&url).call() {
                Ok(_) => Ok(format!("{} 200", client.auth_method)),
                Err(ureq::Error::Status(code, _)) if code < 400 => {
                    Ok(format!("{} {code}", client.auth_method))
                }
                Err(e) => Err(format!("authorize: {e}")),
            }
        });
        match outcome {
            Ok(note) => println!("{:<12} ok ({note})", plugin.id),
            Err(error) => failures.push(format!("{}: {error}", plugin.id)),
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
