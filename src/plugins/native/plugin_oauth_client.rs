//! Cairngorm as an OAuth client: dynamic registration (RFC 7591) as a native public
//! client, PKCE (RFC 7636) and the authorization URL the browser opens.
use super::oauth::{agent, Client, Server};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// A fresh registration per sign-in: loopback ports change, and many servers match
/// redirect URIs exactly.
pub fn register(server: &Server, redirect_uri: &str) -> Result<Client, String> {
    let endpoint = server
        .registration_endpoint
        .as_deref()
        .ok_or("This plugin does not let apps register for sign-in")?;
    let body = json!({
        "client_name": "Cairngorm",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "application_type": "native",
    });
    let reply: Value = agent(endpoint)?
        .post(endpoint)
        .set("accept", "application/json")
        .send_json(body)
        .map_err(|e| format!("The plugin refused to register Cairngorm: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    let client_secret = reply["client_secret"].as_str().map(String::from);
    // A server may issue a secret although none was asked for; use it the way it says.
    let auth_method = reply["token_endpoint_auth_method"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| {
            if client_secret.is_some() {
                "client_secret_basic"
            } else {
                "none"
            }
            .into()
        });
    Ok(Client {
        client_id: reply["client_id"]
            .as_str()
            .ok_or("The plugin returned no client id")?
            .into(),
        client_secret,
        auth_method,
    })
}

/// PKCE pair: a 64-character verifier from two random UUIDs and its S256 challenge.
pub fn pkce() -> (String, String) {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge =
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, digest);
    (verifier, challenge)
}

pub fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn authorize_url(
    server: &Server,
    client: &Client,
    redirect: &str,
    challenge: &str,
    state: &str,
) -> String {
    let mut params = vec![
        ("response_type", "code"),
        ("client_id", client.client_id.as_str()),
        ("redirect_uri", redirect),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("resource", server.resource.as_str()),
    ];
    if let Some(scope) = &server.scope {
        params.push(("scope", scope));
    }
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", encode(v)))
        .collect();
    let sep = if server.authorization_endpoint.contains('?') {
        '&'
    } else {
        '?'
    };
    format!("{}{sep}{}", server.authorization_endpoint, query.join("&"))
}
