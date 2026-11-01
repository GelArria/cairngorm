//! Token endpoint requests: the authorization code exchange and refresh, with the
//! client authentication the server assigned at registration.
use super::oauth::{agent, encode, Client};
use serde_json::Value;

#[derive(Debug)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
}

/// A refused grant needs a new sign-in; an unreachable server may recover by itself.
#[derive(Debug)]
pub enum TokenError {
    Refused(String),
    Unreachable(String),
}

impl TokenError {
    pub fn message(self) -> String {
        match self {
            Self::Refused(message) | Self::Unreachable(message) => message,
        }
    }
}

/// RFC 6749 §5.2 errors that mean this grant or client will never work again.
pub fn is_revoked(status: u16, error: &str) -> bool {
    matches!(status, 400 | 401)
        && matches!(
            error,
            "invalid_grant" | "invalid_client" | "unauthorized_client"
        )
}

/// Token endpoint call shared by the code exchange and refresh.
pub fn token_request<'a>(
    endpoint: &str,
    client: &'a Client,
    mut form: Vec<(&'a str, &'a str)>,
) -> Result<Tokens, TokenError> {
    // A transport setting error is not a verdict on the grant: keep the sign-in.
    let mut request = agent(endpoint)
        .map_err(TokenError::Unreachable)?
        .post(endpoint)
        .set("accept", "application/json");
    match (client.auth_method.as_str(), &client.client_secret) {
        ("client_secret_basic", Some(secret)) => {
            let pair = format!("{}:{}", encode(&client.client_id), encode(secret));
            let basic = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, pair);
            request = request.set("authorization", &format!("Basic {basic}"));
        }
        ("client_secret_post", Some(secret)) => {
            form.push(("client_id", &client.client_id));
            form.push(("client_secret", secret));
        }
        _ => form.push(("client_id", &client.client_id)),
    }
    let reply: Value = match request.send_form(&form) {
        Ok(response) => response
            .into_json()
            .map_err(|e| TokenError::Unreachable(e.to_string()))?,
        Err(ureq::Error::Status(code, response)) => {
            let body: Value = response.into_json().unwrap_or_default();
            let error = body["error"].as_str().unwrap_or_default();
            let reason = body["error_description"].as_str().unwrap_or(error);
            let reason = format!("The plugin refused the sign-in ({code}): {reason}");
            // Only a verdict on the grant or the client ends the sign-in; rate limits,
            // timeouts and server trouble (429, 408, 5xx…) may pass.
            return Err(if is_revoked(code, error) {
                TokenError::Refused(reason)
            } else {
                TokenError::Unreachable(reason)
            });
        }
        Err(e) => {
            let message = format!("Could not reach the plugin's sign-in service: {e}");
            return Err(TokenError::Unreachable(message));
        }
    };
    let access = reply["access_token"].as_str();
    let access = access
        .ok_or_else(|| TokenError::Unreachable("The plugin returned no access token".into()))?;
    Ok(Tokens {
        access_token: access.into(),
        refresh_token: reply["refresh_token"].as_str().map(String::from),
        expires_in: reply["expires_in"].as_u64(),
    })
}
