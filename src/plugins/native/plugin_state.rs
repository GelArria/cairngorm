//! What Settings ▸ Plugins shows: the catalog with each plugin's status, and the agent
//! CLIs that reach it.
use super::{activity, agent_targets::Env, agents, catalog, clients, gateway, tokens};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    category: &'static str,
    logo: &'static str,
    homepage: &'static str,
    terms: &'static str,
    auth: catalog::Auth,
    enabled: bool,
    /// For OAuth plugins: a sign-in is stored. Added but signed out means "sign in again".
    signed_in: bool,
    local_app: bool,
    availability: Option<super::applications::Availability>,
    /// Bundled document provider that opens this application's files in panes ("" when none).
    document_provider: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsState {
    plugins: Vec<PluginInfo>,
    agents: Vec<agents::AgentRegistration>,
    clients: Vec<clients::ClientStatus>,
    discovered_clients: Vec<activity::ClientActivity>,
    runtime: Option<String>,
    agents_connected: bool,
    files_enabled: bool,
    files_access: &'static str,
    /// Applications agents may script without asking, each in one project.
    app_grants: Vec<catalog::AppGrant>,
    files_available: bool,
    word_available: bool,
    bridge_config: Option<Value>,
    error: Option<String>,
}

pub fn state(
    dir: &Path,
    home: &Path,
    env: Env,
    bridge: &str,
    error: Option<String>,
) -> PluginsState {
    let enabled = catalog::enabled(dir);
    let runtime = agents::runtime();
    let revision = gateway::running().map(|g| g.revision()).unwrap_or_default();
    let activity = activity::snapshot(&revision);
    let mut error = error;
    let mut clients = clients::list(dir, bridge).unwrap_or_else(|e| {
        error = Some(e);
        Vec::new()
    });
    for client in &mut clients {
        if client.registered {
            client.activity = activity
                .iter()
                .filter(|a| a.registration.as_deref() == Some(&client.client.id))
                .min_by_key(|a| (a.synced, a.last_seen))
                .cloned();
        }
    }
    let agents = with_activity(agents::status(home, env, bridge), &activity);
    let discovered_clients = activity
        .into_iter()
        .filter(|a| {
            a.registration.is_none()
                && !agents
                    .iter()
                    .any(|known| known.registered && a.agent == Some(known.id))
        })
        .collect();
    PluginsState {
        plugins: catalog::catalog()
            .iter()
            .map(|p| PluginInfo {
                id: p.id,
                name: p.name,
                description: p.description,
                category: p.category,
                logo: p.logo,
                homepage: p.homepage,
                terms: p.terms,
                auth: p.auth,
                enabled: enabled.iter().any(|e| e.id == p.id),
                signed_in: p.auth == catalog::Auth::OAuth && tokens::signed_in(p.id),
                local_app: p.local_app,
                availability: p.local_app.then(|| super::applications::availability(p.id)),
                document_provider: p.document_provider,
            })
            .collect(),
        agents,
        clients,
        discovered_clients,
        bridge_config: runtime.as_ref().map(|command| {
            json!({
                "mcpServers": { "cairngorm": { "command": command, "args": [bridge] } }
            })
        }),
        runtime,
        agents_connected: catalog::agents_connected(dir),
        files_enabled: catalog::files_enabled(dir),
        files_access: catalog::files_access(dir),
        app_grants: catalog::app_grants(dir),
        files_available: cfg!(windows),
        word_available: false,
        error,
    }
}

fn with_activity(
    mut agents: Vec<agents::AgentRegistration>,
    activity: &[activity::ClientActivity],
) -> Vec<agents::AgentRegistration> {
    for agent in &mut agents {
        agent.activity = activity
            .iter()
            .filter(|a| a.registration.is_none() && a.agent == Some(agent.id))
            .min_by_key(|a| (a.synced, a.last_seen))
            .cloned();
        agent.last_seen = agent.activity.as_ref().map(|a| a.last_seen);
    }
    agents
}
