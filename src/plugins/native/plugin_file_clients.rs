//! File access requires a verified owned registration, not a client's handshake label.
use super::{
    agent_targets::{self, Env},
    agents, clients,
};
use std::path::Path;

pub(super) fn allowed(
    dir: &Path,
    home: &Path,
    env: Env,
    bridge: &str,
    registration: Option<&str>,
    process_agent: Option<&str>,
) -> bool {
    if let Some(id) = registration.filter(|id| !id.is_empty()) {
        return clients::list(dir, bridge).is_ok_and(|clients| {
            clients
                .iter()
                .any(|client| client.client.id == id && client.registered)
        });
    }
    let Some(agent) = process_agent else {
        return false;
    };
    agent_targets::targets(home, env)
        .into_iter()
        .find(|target| target.id == agent && target.installed())
        .is_some_and(|target| {
            agents::read(&target.file)
                .and_then(|text| agents::registered(target.format, &text, bridge))
                == Ok(true)
        })
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_file_clients.rs"]
mod tests;
