use super::{activity, callers::Caller};
use serde_json::json;

#[test]
fn standard_handshakes_discover_arbitrary_clients_and_track_actual_catalog_reads() {
    let name = format!("Independent CLI {}", uuid::Uuid::new_v4());
    let caller = Caller {
        terminal: Some(uuid::Uuid::new_v4().to_string()),
        agent: None,
    };
    let init = json!({"method":"initialize", "params":{"clientInfo":{"name":name,"version":"1"}}});
    let list = json!({"method":"tools/list"});
    let read = json!({"tools":[]});
    let mine = |revision| {
        activity::snapshot_with(revision, |_, _, _| true)
            .into_iter()
            .find(|a| a.name == name)
    };
    activity::record(&caller, Some("321"), None, &list, &read, "r1");
    assert!(
        mine("r1").is_none(),
        "a tools/list without a successful handshake proves nothing"
    );
    activity::record(&caller, Some("321"), None, &init, &json!({}), "r1");
    assert!(mine("r1").is_none());
    activity::record(&caller, Some("999"), None, &list, &read, "r1");
    assert!(
        mine("r1").is_none(),
        "another bridge cannot complete this handshake"
    );
    activity::record(&caller, Some("321"), None, &list, &read, "r1");
    assert!(mine("r1").unwrap().synced);
    assert!(!mine("r2").unwrap().synced);
    activity::record(
        &caller,
        Some("321"),
        None,
        &json!({"method":"ping"}),
        &json!({}),
        "r2",
    );
    assert!(
        !mine("r2").unwrap().synced,
        "pings never claim a refreshed catalog"
    );
    activity::record(&caller, Some("321"), None, &list, &read, "r2");
    assert!(mine("r2").unwrap().synced);
    assert!(activity::snapshot_with("r2", |_, _, _| false).is_empty());
}

#[test]
fn saved_clients_bind_to_the_bridge_not_a_hardcoded_agent_name() {
    let id = uuid::Uuid::new_v4().to_string();
    let pid = std::process::id().to_string();
    let caller = Caller {
        terminal: Some(uuid::Uuid::new_v4().to_string()),
        agent: None,
    };
    let init = json!({"method":"initialize","params":{"clientInfo":{"name":"Brand new client"}}});
    activity::record(&caller, Some(&pid), Some(&id), &init, &json!({}), "r1");
    activity::record(
        &caller,
        Some(&pid),
        Some(&id),
        &json!({"method":"tools/list"}),
        &json!({"tools":[]}),
        "r1",
    );
    let found = activity::snapshot_with("r1", |_, _, started| started.is_some())
        .into_iter()
        .find(|a| a.registration.as_deref() == Some(&id))
        .unwrap();
    assert_eq!(found.name, "Brand new client");
    assert!(found.agent.is_none());
    assert!(found.synced);
}

#[test]
fn a_replacement_bridge_in_the_same_terminal_does_not_inherit_a_dead_bridges_stale_catalog() {
    let id = uuid::Uuid::new_v4().to_string();
    let caller = Caller {
        terminal: Some(uuid::Uuid::new_v4().to_string()),
        agent: None,
    };
    let init = json!({"method":"initialize","params":{"clientInfo":{"name":"My CLI"}}});
    let list = json!({"method":"tools/list"});
    let read = json!({"tools":[]});
    activity::record(&caller, Some("100"), Some(&id), &init, &json!({}), "r1");
    activity::record(&caller, Some("100"), Some(&id), &list, &read, "r1");
    activity::record(&caller, Some("200"), Some(&id), &init, &json!({}), "r2");
    activity::record(&caller, Some("200"), Some(&id), &list, &read, "r2");
    let live = activity::snapshot_with("r2", |_, pid, _| pid == 200)
        .into_iter()
        .filter(|a| a.registration.as_deref() == Some(&id))
        .collect::<Vec<_>>();
    assert_eq!(live.len(), 1);
    assert!(live[0].synced, "the restarted CLI refreshed successfully");
    let both_live = activity::snapshot_with("r2", |_, _, _| true)
        .into_iter()
        .filter(|a| a.registration.as_deref() == Some(&id))
        .collect::<Vec<_>>();
    assert!(
        both_live.iter().any(|a| !a.synced),
        "a genuinely live stale client still needs a warning"
    );
}
