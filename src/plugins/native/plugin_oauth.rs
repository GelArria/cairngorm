//! OAuth for remote MCP servers (MCP authorization spec): protected resource metadata
//! (RFC 9728) names the authorization server, whose metadata (RFC 8414) gives the
//! endpoints. Cairngorm registers itself (RFC 7591) as a native public client and signs in
//! with PKCE (RFC 7636) through a loopback redirect (RFC 8252).
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub use super::oauth_client::{authorize_url, encode, pkce, register};
pub use super::oauth_token::{token_request, TokenError, Tokens};

const TIMEOUT: Duration = Duration::from_secs(20);

/// Where and how to sign in for one MCP server.
#[derive(Clone, Debug)]
pub struct Server {
    /// The protected resource, sent as `resource` so tokens are bound to this server.
    pub resource: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub scope: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Client {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    /// `none`, `client_secret_basic` or `client_secret_post`.
    pub auth_method: String,
}

/// A client for one sign-in request; the proxy route depends on its address.
pub(super) fn agent(url: &str) -> Result<ureq::Agent, String> {
    Ok(crate::http_transport::agent_builder(url)?
        .timeout(TIMEOUT)
        .build())
}

fn get_json(url: &str) -> Option<Value> {
    let response = agent(url)
        .ok()?
        .get(url)
        .set("accept", "application/json")
        .call()
        .ok()?;
    response.into_json().ok()
}

/// Sign-in addresses come from the servers themselves; only HTTPS ones are followed, so a
/// misconfigured server cannot send codes or secrets in clear or open other kinds of links.
/// Tests run their fake servers on plain loopback HTTP.
pub fn secure(url: &str) -> bool {
    url.starts_with("https://") || (cfg!(test) && url.starts_with("http://127.0.0.1:"))
}

/// `https://host/a/b` → `https://host/.well-known/<name>/a/b` (RFC 8414 §3 path insertion).
pub fn well_known(url: &str, name: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('/');
    let suffix = if path.is_empty() {
        String::new()
    } else {
        format!("/{path}")
    };
    Some(format!("{scheme}://{host}/.well-known/{name}{suffix}"))
}

fn origin(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    Some(format!("{scheme}://{}", rest.split('/').next()?))
}

/// The `resource_metadata` URL a 401 challenge points at, if any.
pub fn challenge_metadata(header: &str) -> Option<String> {
    let start = header.find("resource_metadata=\"")? + "resource_metadata=\"".len();
    let end = header[start..].find('"')?;
    Some(header[start..start + end].to_string())
}

/// Ask the server who signs its users in. An unauthenticated `initialize` gets the 401
/// challenge; servers without one publish metadata at the well-known locations.
pub fn discover(server_url: &str) -> Result<Server, String> {
    let probe = json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {},
        "clientInfo": { "name": "Cairngorm", "version": env!("CARGO_PKG_VERSION") } } });
    let challenge = match agent(server_url)?
        .post(server_url)
        .set("accept", "application/json, text/event-stream")
        .send_json(probe)
    {
        Err(ureq::Error::Status(401, response)) => {
            response.header("www-authenticate").map(String::from)
        }
        _ => None,
    };
    let mut candidates: Vec<String> = challenge
        .as_deref()
        .and_then(challenge_metadata)
        .into_iter()
        .collect();
    candidates.extend(well_known(server_url, "oauth-protected-resource"));
    candidates
        .extend(origin(server_url).map(|o| format!("{o}/.well-known/oauth-protected-resource")));
    let resource_meta = candidates
        .iter()
        .filter(|url| secure(url))
        .find_map(|url| get_json(url));
    let issuer = resource_meta
        .as_ref()
        .and_then(|m| m["authorization_servers"][0].as_str().map(String::from))
        .or_else(|| origin(server_url))
        .filter(|issuer| secure(issuer))
        .ok_or("The plugin's sign-in service is not on a secure address")?;
    let meta = [
        well_known(&issuer, "oauth-authorization-server"),
        well_known(&issuer, "openid-configuration"),
        Some(format!(
            "{}/.well-known/openid-configuration",
            issuer.trim_end_matches('/')
        )),
    ]
    .into_iter()
    .flatten()
    .find_map(|url| get_json(&url))
    .ok_or("The plugin's sign-in service could not be found")?;
    let field = |name: &str| meta[name].as_str().map(String::from);
    let scopes = resource_meta
        .as_ref()
        .and_then(|m| m["scopes_supported"].as_array());
    let scope = scopes
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|s| !s.is_empty());
    let server = Server {
        resource: resource_meta
            .as_ref()
            .and_then(|m| m["resource"].as_str().map(String::from))
            .unwrap_or_else(|| server_url.to_string()),
        authorization_endpoint: field("authorization_endpoint")
            .ok_or("The plugin has no sign-in page")?,
        token_endpoint: field("token_endpoint").ok_or("The plugin has no token endpoint")?,
        registration_endpoint: field("registration_endpoint"),
        scope,
    };
    let endpoints = [
        Some(&server.authorization_endpoint),
        Some(&server.token_endpoint),
        server.registration_endpoint.as_ref(),
    ];
    if !endpoints.into_iter().flatten().all(|url| secure(url)) {
        return Err("The plugin's sign-in service is not on a secure address".into());
    }
    Ok(server)
}
