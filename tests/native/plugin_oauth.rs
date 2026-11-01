// End to end against a fake MCP server and authorization server on loopback.
use super::{callback, catalog, http, sign_in, tokens, upstream, vault};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    net::TcpListener,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Default)]
struct Fake {
    challenge: Option<String>,
    issued: u32,
    /// Access tokens the MCP endpoint accepts.
    valid: Vec<String>,
    refreshes: u32,
}

fn token_reply(fake: &mut Fake) -> Value {
    fake.issued += 1;
    let access = format!("access-{}", fake.issued);
    fake.valid.push(access.clone());
    json!({ "access_token": access, "refresh_token": format!("refresh-{}", fake.issued),
            "token_type": "Bearer", "expires_in": 3600 })
}

/// Serves the protected resource, its metadata and a whole authorization server.
fn fake_server() -> (String, Arc<Mutex<Fake>>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let fake = Arc::new(Mutex::new(Fake::default()));
    let (origin, state) = (base.clone(), fake.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let mut stream = stream.unwrap();
            let Ok(request) = http::read_request(&mut stream) else {
                continue;
            };
            let (path, query) = request.path.split_once('?').unwrap_or((&request.path, ""));
            let query = callback::parse_query(query);
            let form = callback::parse_query(&String::from_utf8_lossy(&request.body));
            let mut fake = state.lock().unwrap();
            let json_reply = |stream: &mut std::net::TcpStream, value: Value| {
                let headers = [("Content-Type", "application/json".to_string())];
                http::respond(stream, "200 OK", &headers, value.to_string().as_bytes());
            };
            match path {
                "/mcp" => {
                    let auth = request.header("authorization").unwrap_or_default();
                    let ok = fake.valid.iter().any(|t| auth == format!("Bearer {t}"));
                    if !ok {
                        let challenge = format!("Bearer resource_metadata=\"{origin}/.well-known/oauth-protected-resource/mcp\"");
                        http::respond(
                            &mut stream,
                            "401 Unauthorized",
                            &[("WWW-Authenticate", challenge)],
                            b"",
                        );
                        continue;
                    }
                    let message: Value = serde_json::from_slice(&request.body).unwrap();
                    let result = match message["method"].as_str() {
                        Some("tools/list") => {
                            json!({ "tools": [{ "name": "echo", "inputSchema": {} }] })
                        }
                        _ => json!({ "protocolVersion": "2025-06-18", "capabilities": {} }),
                    };
                    json_reply(
                        &mut stream,
                        json!({ "jsonrpc": "2.0", "id": message["id"], "result": result }),
                    );
                }
                "/.well-known/oauth-protected-resource/mcp" => json_reply(
                    &mut stream,
                    json!({
                    "resource": format!("{origin}/mcp"), "authorization_servers": [origin], "scopes_supported": ["read", "write"] }),
                ),
                "/.well-known/oauth-authorization-server" => json_reply(
                    &mut stream,
                    json!({
                    "issuer": origin, "authorization_endpoint": format!("{origin}/authorize"),
                    "token_endpoint": format!("{origin}/token"), "registration_endpoint": format!("{origin}/register"),
                    "code_challenge_methods_supported": ["S256"] }),
                ),
                "/register" => json_reply(
                    &mut stream,
                    json!({ "client_id": "client-1", "token_endpoint_auth_method": "none" }),
                ),
                "/authorize" => {
                    assert_eq!(query["code_challenge_method"], "S256");
                    assert_eq!(query["scope"], "read write");
                    assert_eq!(query["resource"], format!("{origin}/mcp"));
                    fake.challenge = Some(query["code_challenge"].clone());
                    let to = format!(
                        "{}?code=code-1&state={}",
                        query["redirect_uri"], query["state"]
                    );
                    http::respond(&mut stream, "302 Found", &[("Location", to)], b"");
                }
                "/token" if form["grant_type"] == "authorization_code" => {
                    let digest = Sha256::digest(form["code_verifier"].as_bytes());
                    let expected = base64::Engine::encode(
                        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                        digest,
                    );
                    assert_eq!(
                        fake.challenge.as_deref(),
                        Some(expected.as_str()),
                        "PKCE verifier mismatch"
                    );
                    assert_eq!(
                        (form["code"].as_str(), form["client_id"].as_str()),
                        ("code-1", "client-1")
                    );
                    let reply = token_reply(&mut fake);
                    json_reply(&mut stream, reply);
                }
                "/token" => {
                    assert_eq!(form["grant_type"], "refresh_token");
                    assert_eq!(form["refresh_token"], format!("refresh-{}", fake.issued));
                    fake.refreshes += 1;
                    let reply = token_reply(&mut fake);
                    json_reply(&mut stream, reply);
                }
                _ => http::respond(&mut stream, "404 Not Found", &[], b""),
            }
        }
    });
    (base, fake)
}

fn spec(id: &'static str, server_url: String) -> &'static catalog::PluginSpec {
    Box::leak(Box::new(catalog::PluginSpec {
        id,
        name: "Fake",
        description: "",
        category: "",
        logo: "",
        server_url: Box::leak(server_url.into_boxed_str()),
        homepage: "",
        terms: "",
        view_css: "",
        local_app: false,
        auth: catalog::Auth::OAuth,
        document_provider: "",
        mcp: "",
    }))
}

/// The app runs one sign-in at a time (a new one cancels the last), so tests take turns.
fn one_sign_in_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    static TURN: Mutex<()> = Mutex::new(());
    TURN.lock().unwrap_or_else(|e| e.into_inner())
}

/// Plays the browser: follows the sign-in page's redirect to the loopback callback.
fn browser(url: &str) -> Result<(), String> {
    let url = url.to_string();
    std::thread::spawn(move || {
        let page = ureq::get(&url).call().unwrap().into_string().unwrap();
        assert!(page.contains("Signed in to Fake"), "{page}");
    });
    Ok(())
}

#[test]
fn signing_in_discovers_registers_and_exchanges_with_pkce() {
    let _one = one_sign_in_at_a_time();
    let (base, fake) = fake_server();
    let plugin = spec("fake-oauth-sign-in", format!("{base}/mcp"));
    assert!(!tokens::signed_in(plugin.id));
    sign_in::sign_in(plugin, browser).unwrap();
    assert!(tokens::signed_in(plugin.id));
    assert_eq!(tokens::bearer(plugin.id, "Fake").unwrap(), "access-1");
    // The vault keeps the refresh token, never the access token beside it.
    let stored = vault::get(plugin.id).unwrap().unwrap();
    assert!(
        stored.contains("refresh-1") && !stored.contains("access-1"),
        "{stored}"
    );

    // A rejected token is renewed once with the refresh token, then the call succeeds.
    let upstream = upstream::Upstream::new(plugin);
    fake.lock().unwrap().valid.clear();
    let tools = upstream.tools().unwrap();
    assert_eq!(tools[0]["name"], "echo");
    assert_eq!(fake.lock().unwrap().refreshes, 1);
    assert_eq!(tokens::bearer(plugin.id, "Fake").unwrap(), "access-2");

    tokens::forget(plugin.id);
    assert!(!tokens::signed_in(plugin.id));
    upstream.reset();
    let error = upstream.tools().unwrap_err();
    assert!(error.contains("Sign in to Fake again"), "{error}");
}

#[test]
fn a_cancelled_sign_in_stops_waiting() {
    let _one = one_sign_in_at_a_time();
    let (base, _) = fake_server();
    let plugin = spec("fake-oauth-cancel", format!("{base}/mcp"));
    // The "browser" never comes back; the user cancels from Settings instead.
    let canceller = std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(400));
        sign_in::cancel();
    });
    let error = sign_in::sign_in(plugin, |_| Ok(())).unwrap_err();
    canceller.join().unwrap();
    assert_eq!(error, sign_in::CANCELLED);
    assert!(!tokens::signed_in(plugin.id));
}
