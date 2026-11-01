//! Browser sign-in for an OAuth plugin: discover the sign-in service, register, open the
//! browser, take the code from the loopback redirect and keep the tokens. One sign-in at a
//! time; it can be cancelled at any step.
use super::{callback, catalog::PluginSpec, oauth, tokens};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

pub use callback::CANCELLED;

/// The sign-in in progress. A new one cancels the previous one.
static ACTIVE: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

pub fn cancel() {
    if let Some(flag) = ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).take() {
        flag.store(true, Ordering::SeqCst);
    }
}

/// Clears `ACTIVE` when this sign-in ends however it ends, unless a newer one replaced it.
struct Turn(Arc<AtomicBool>);

impl Turn {
    fn take() -> Self {
        cancel();
        let flag = Arc::new(AtomicBool::new(false));
        *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some(flag.clone());
        Self(flag)
    }

    /// Between steps: each network call can take seconds, and Cancel must win at once.
    fn check(&self) -> Result<(), String> {
        match self.0.load(Ordering::SeqCst) {
            true => Err(CANCELLED.into()),
            false => Ok(()),
        }
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        let mut active = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
        if active
            .as_ref()
            .is_some_and(|flag| Arc::ptr_eq(flag, &self.0))
        {
            *active = None;
        }
    }
}

pub fn sign_in(
    plugin: &PluginSpec,
    open: impl Fn(&str) -> Result<(), String>,
) -> Result<(), String> {
    let turn = Turn::take();
    let server = oauth::discover(plugin.server_url)?;
    turn.check()?;
    let (listener, redirect_uri) = callback::listen()?;
    let client = oauth::register(&server, &redirect_uri)?;
    turn.check()?;
    let (verifier, challenge) = oauth::pkce();
    let state = uuid::Uuid::new_v4().simple().to_string();
    open(&oauth::authorize_url(
        &server,
        &client,
        &redirect_uri,
        &challenge,
        &state,
    ))?;
    let redirect = callback::wait(&listener, &state, plugin.name, &turn.0)?;
    let form = vec![
        ("grant_type", "authorization_code"),
        ("code", redirect.code.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", verifier.as_str()),
        ("resource", server.resource.as_str()),
    ];
    // The tab says "signed in" only once the tokens are safely kept.
    let outcome = oauth::token_request(&server.token_endpoint, &client, form)
        .map_err(oauth::TokenError::message)
        .and_then(|tokens| {
            tokens::save(
                plugin.id,
                client,
                server.token_endpoint,
                server.resource,
                tokens,
            )
        });
    let name = plugin.name;
    match &outcome {
        Ok(()) => redirect.finish(&format!(
            "Signed in to {name}. You can close this tab and go back to Cairngorm."
        )),
        Err(error) => redirect.finish(&format!("Signing in to {name} did not finish: {error}")),
    }
    outcome
}
