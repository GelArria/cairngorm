//! Plugin sign-ins: kept in the OS credential store and cached in memory. The access token
//! is renewed with the refresh token, so a restart costs one refresh instead of a sign-in;
//! it is only stored when the server issues no refresh token.
use super::{
    oauth::{self, Client},
    vault,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

/// Renew this long before expiry so a slow tool call never carries a dying token.
const EARLY: u64 = 60;

#[derive(Clone, Deserialize, Serialize)]
pub struct SignIn {
    pub client: Client,
    pub token_endpoint: String,
    pub resource: String,
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    /// Unix seconds; unknown expiry means "until the server says otherwise".
    #[serde(default)]
    pub expires_at: Option<u64>,
}

/// One plugin's sign-in as this process knows it. `generation` grows on every sign-in and
/// sign-out, so work that started under an older one cannot overwrite or erase a newer one.
#[derive(Default)]
struct Slot {
    loaded: bool,
    sign_in: Option<SignIn>,
    generation: u64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

fn slots() -> MutexGuard<'static, HashMap<String, Slot>> {
    static SLOTS: OnceLock<Mutex<HashMap<String, Slot>>> = OnceLock::new();
    SLOTS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// The sign-in and its generation. An unavailable store is not remembered as "signed out":
/// the next call asks again.
fn load(id: &str) -> (Option<SignIn>, u64) {
    let mut slots = slots();
    let slot = slots.entry(id.to_string()).or_default();
    if !slot.loaded {
        match vault::get(id) {
            Ok(text) => {
                slot.sign_in = text.and_then(|t| serde_json::from_str(&t).ok());
                slot.loaded = true;
            }
            Err(error) => eprintln!("[plugins] {id}: {error}"),
        }
    }
    (slot.sign_in.clone(), slot.generation)
}

/// Memory first, so this session keeps working even when the store refuses the write.
/// `Ok(false)`: a sign-in or sign-out happened meanwhile and this one was dropped.
fn store(id: &str, sign_in: &SignIn, since: Option<u64>) -> Result<bool, String> {
    {
        let mut slots = slots();
        let slot = slots.entry(id.to_string()).or_default();
        if since.is_some_and(|g| g != slot.generation) {
            return Ok(false);
        }
        if since.is_none() {
            slot.generation += 1;
        }
        slot.sign_in = Some(sign_in.clone());
        slot.loaded = true;
    }
    let mut saved = sign_in.clone();
    // Without a refresh token the access token is the sign-in; with one it is not needed
    // across restarts.
    if saved.refresh_token.is_some() {
        saved.access_token = None;
        saved.expires_at = None;
    }
    let text = serde_json::to_string(&saved).map_err(|e| e.to_string())?;
    vault::put(id, &text)?;
    Ok(true)
}

pub fn save(
    id: &str,
    client: Client,
    token_endpoint: String,
    resource: String,
    tokens: oauth::Tokens,
) -> Result<(), String> {
    let sign_in = SignIn {
        client,
        token_endpoint,
        resource,
        refresh_token: tokens.refresh_token,
        access_token: Some(tokens.access_token),
        expires_at: tokens.expires_in.map(|s| now() + s),
    };
    store(id, &sign_in, None).map(|_| ())
}

pub fn signed_in(id: &str) -> bool {
    load(id).0.is_some()
}

/// Signing out of a removed plugin: nothing of it stays on this machine.
pub fn forget(id: &str) {
    {
        let mut slots = slots();
        let slot = slots.entry(id.to_string()).or_default();
        slot.generation += 1;
        slot.sign_in = None;
        slot.loaded = true;
    }
    vault::delete(id);
}

/// The server turned `token` down twice: sign out, unless a newer sign-in replaced it.
pub fn forget_rejected(id: &str, token: &str) {
    let current = load(id).0.and_then(|s| s.access_token);
    if current.is_none() || current.as_deref() == Some(token) {
        forget(id);
    }
}

/// The server turned the token down: drop it so the next request refreshes.
pub fn rejected(id: &str, token: &str) {
    if let Some(sign_in) = slots().get_mut(id).and_then(|s| s.sign_in.as_mut()) {
        if sign_in.access_token.as_deref() == Some(token) {
            sign_in.access_token = None;
        }
    }
}

fn fresh(sign_in: &SignIn) -> Option<String> {
    let live = sign_in.expires_at.is_none_or(|at| at > now() + EARLY);
    sign_in.access_token.clone().filter(|_| live)
}

/// One refresh per plugin at a time: servers that rotate refresh tokens revoke the one a
/// concurrent refresh already spent. Other plugins are not held up.
fn refresh_turn(id: &str) -> Arc<Mutex<()>> {
    static TURNS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut turns = TURNS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    turns.entry(id.to_string()).or_default().clone()
}

/// A usable access token, refreshed when needed. Errors mean the user must sign in again,
/// except an unreachable sign-in service, which is reported as is and retried next call.
pub fn bearer(id: &str, name: &str) -> Result<String, String> {
    let again = || format!("Sign in to {name} again in Settings ▸ Plugins.");
    if let Some(token) = load(id).0.as_ref().and_then(fresh) {
        return Ok(token);
    }
    let turn = refresh_turn(id);
    let _turn = turn.lock().unwrap_or_else(|e| e.into_inner());
    // A waiter finds the token the refresh it waited for stored.
    let (sign_in, generation) = load(id);
    let mut sign_in = sign_in.ok_or_else(again)?;
    if let Some(token) = fresh(&sign_in) {
        return Ok(token);
    }
    let Some(refresh) = sign_in.refresh_token.clone() else {
        // Nothing can renew it: show "Sign in" in Settings instead of a dead "Added".
        if load(id).1 == generation {
            forget(id);
        }
        return Err(again());
    };
    let form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh.as_str()),
        ("resource", sign_in.resource.as_str()),
    ];
    let tokens = match oauth::token_request(&sign_in.token_endpoint, &sign_in.client, form) {
        Ok(tokens) => tokens,
        Err(oauth::TokenError::Unreachable(message)) => return Err(message),
        Err(oauth::TokenError::Refused(reason)) => {
            eprintln!("[plugins] {id}: refresh refused: {reason}");
            // A revoked grant cannot recover; keep it from looking signed in.
            if load(id).1 == generation {
                forget(id);
            }
            return Err(again());
        }
    };
    sign_in.access_token = Some(tokens.access_token.clone());
    sign_in.expires_at = tokens.expires_in.map(|s| now() + s);
    // Servers that rotate refresh tokens invalidate the old one.
    if tokens.refresh_token.is_some() {
        sign_in.refresh_token = tokens.refresh_token;
    }
    match store(id, &sign_in, Some(generation)) {
        // Removed or signed in again meanwhile: this token belongs to the old sign-in.
        Ok(false) => Err(again()),
        Ok(true) => Ok(tokens.access_token),
        // Kept in memory; the next start signs in again only if the store stays broken.
        Err(error) => {
            eprintln!("[plugins] {id}: {error}");
            Ok(tokens.access_token)
        }
    }
}
