use super::super::{catalog, file_permissions::Decision, files};
use super::*;
use serde_json::{json, Value};
use std::{fs, time::Duration};
#[path = "plugin_file_scope_fixture.rs"]
mod fixture;
use fixture::Scratch;

#[cfg(windows)]
fn setup(scratch: &Scratch) -> (FileRuntime, Arc<Scope>) {
    let mut runtime = FileRuntime::default();
    runtime.set_enabled(true);
    runtime
        .sync(
            vec![TerminalFileScope {
                session_id: "terminal-a".into(),
                project_id: "project-a".into(),
                root_path: scratch.root().to_string_lossy().into_owned(),
            }],
            vec![],
        )
        .unwrap();
    let scope = runtime.scope("terminal-a").unwrap();
    (runtime, scope)
}

#[cfg(windows)]
#[test]
fn eligible_terminal_changes_announce_catalog_updates_but_dirty_paths_do_not() {
    let scratch = Scratch::new();
    let mut runtime = FileRuntime::default();
    runtime.set_enabled(true);
    let metadata = vec![TerminalFileScope {
        session_id: "fresh".into(),
        project_id: "project".into(),
        root_path: scratch.root().to_string_lossy().into_owned(),
    }];
    let revision = catalog::revision();
    assert!(runtime.sync(metadata.clone(), vec![]).unwrap());
    assert!(catalog::revision() > revision);
    assert!(!runtime
        .sync(metadata.clone(), vec!["dirty-file".into()])
        .unwrap());
    let revision = catalog::revision();
    assert!(runtime.sync(vec![], vec![]).unwrap());
    assert!(catalog::revision() > revision);
    assert!(!runtime.sync(vec![], vec![]).unwrap());
    runtime.set_enabled(false);
    assert!(!runtime.sync(metadata, vec![]).unwrap());
    let revision = catalog::revision();
    runtime.set_enabled(true);
    assert!(runtime.scope("fresh").is_ok());
    assert!(catalog::revision() > revision);
}

#[cfg(windows)]
#[test]
fn reads_are_utf8_bounded_hashed_and_use_matching_mcp_structured_content() {
    let scratch = Scratch::new();
    let (_runtime, scope) = setup(&scratch);
    let value = files::read(&scope, files::READ, "Unicode-校验/notes.txt", |_| {
        panic!("project read must not ask for approval")
    })
    .unwrap();
    assert_eq!(value["content"], "original\r\nbytes");
    use sha2::{Digest, Sha256};
    assert_eq!(
        value["sha256"],
        format!("{:x}", Sha256::digest(b"original\r\nbytes"))
    );
    let response = files::result(Ok(value.clone()));
    assert_eq!(response["isError"], false);
    assert_eq!(
        serde_json::from_str::<Value>(response["content"][0]["text"].as_str().unwrap()).unwrap(),
        value
    );
    assert_eq!(response["structuredContent"], value);
    for (name, bytes, code) in [
        ("zero-bytes.bin", vec![0], "binary-file"),
        ("invalid", vec![255], "binary-file"),
        ("large", vec![65; 1024 * 1024 + 1], "file-too-large"),
    ] {
        fs::write(scratch.root().join(name), bytes).unwrap();
        assert_eq!(
            files::read(&scope, files::READ, name, |_| {})
                .err()
                .unwrap()
                .code,
            code
        );
    }
}

#[cfg(windows)]
#[test]
fn list_is_bounded_nonrecursive_and_does_not_follow_reparse_targets() {
    let scratch = Scratch::new();
    let (_runtime, scope) = setup(&scratch);
    for index in 0..1002 {
        fs::write(scratch.root().join(format!("entry-{index}")), b"x").unwrap();
    }
    fixture::directory_link(
        Path::new(r"\\cairngorm-must-not-contact.invalid\share"),
        &scratch.root().join("remote-alias"),
    );
    let value = files::read(&scope, files::LIST, ".", |_| {}).unwrap();
    assert_eq!(value["entries"].as_array().unwrap().len(), 1000);
    assert_eq!(value["truncated"], true);
    assert!(value["entries"]
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| entry["size"].is_null()));
    assert!(files::read(&scope, files::LIST, "remote-alias", |_| {}).is_err());
}

#[cfg(windows)]
#[test]
fn external_approval_is_path_bound_and_never_grants_a_sibling_or_another_terminal() {
    let scratch = Scratch::new();
    let (mut runtime, scope) = setup(&scratch);
    let path = scope.root.resolve("../outside/secret.txt").unwrap();
    assert!(runtime.permissions.granted(&scope, &path).is_none());
    let (id, receiver) = runtime
        .permissions
        .request(scope.clone(), path.clone(), false)
        .unwrap();
    runtime.permissions.reply(&id, Decision::File).unwrap();
    let grant = receiver
        .recv_timeout(Duration::from_millis(100))
        .unwrap()
        .unwrap();
    assert_eq!(
        grant
            .root
            .open_read(path.to_str().unwrap())
            .unwrap()
            .snapshot(1024)
            .unwrap()
            .bytes,
        b"not authorized"
    );
    assert!(runtime.permissions.granted(&scope, &path).is_some());
    assert!(runtime
        .permissions
        .granted(&scope, &path.with_file_name("other.txt"))
        .is_none());
    let other = Scope {
        metadata: TerminalFileScope {
            session_id: "terminal-b".into(),
            ..scope.metadata.clone()
        },
        root: scope.root.clone(),
        epoch: scope.epoch.clone(),
    };
    assert!(runtime.permissions.granted(&other, &path).is_none());
    assert!(runtime.permissions.reply(&id, Decision::Folder).is_err());
    assert!(runtime
        .permissions
        .reply("invented-request", Decision::Folder)
        .is_err());
}

#[cfg(windows)]
#[test]
fn folder_approval_deny_revocation_and_queue_limit_are_session_scoped() {
    let scratch = Scratch::new();
    let (mut runtime, scope) = setup(&scratch);
    let path = scope.root.resolve("../outside/secret.txt").unwrap();
    let (id, receiver) = runtime
        .permissions
        .request(scope.clone(), path.clone(), false)
        .unwrap();
    runtime.permissions.reply(&id, Decision::Deny).unwrap();
    assert!(receiver
        .recv_timeout(Duration::from_millis(100))
        .unwrap()
        .is_none());
    assert!(runtime.permissions.granted(&scope, &path).is_none());
    let (id, receiver) = runtime
        .permissions
        .request(scope.clone(), path.clone(), false)
        .unwrap();
    runtime.permissions.reply(&id, Decision::Folder).unwrap();
    assert!(receiver
        .recv_timeout(Duration::from_millis(100))
        .unwrap()
        .is_some());
    assert!(runtime
        .permissions
        .granted(&scope, &path.with_file_name("another.txt"))
        .is_some());
    assert!(runtime
        .permissions
        .granted(
            &scope,
            &scope.root.resolve("../outside-other/secret.txt").unwrap()
        )
        .is_none());
    let mut pending = Vec::new();
    for _ in 0..16 {
        pending.push(
            runtime
                .permissions
                .request(scope.clone(), path.clone(), false)
                .unwrap()
                .1,
        );
    }
    assert_eq!(
        runtime
            .permissions
            .request(scope.clone(), path.clone(), false)
            .err()
            .unwrap()
            .code,
        "permission-queue-full"
    );
    runtime.set_enabled(false);
    assert!(!runtime.current(&scope));
    for receiver in pending {
        assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
    }
    runtime.set_enabled(true);
    let next = runtime.scope("terminal-a").unwrap();
    assert!(runtime.permissions.granted(&next, &path).is_none());
    assert!(!runtime.current(&scope));
    runtime.sync(vec![], vec![]).unwrap();
    assert!(!runtime.current(&next));
}

#[test]
fn disabled_and_external_callers_get_no_tools_and_guessed_names_return_readable_denial() {
    assert!(files::eligible(None, true, true, |_| true).is_none());
    for (allowed, consent, live) in [
        (false, true, true),
        (true, false, true),
        (true, true, false),
    ] {
        assert!(files::eligible(Some("source"), allowed, consent, |_| live).is_none());
    }
    let denied = files::call(
        &json!({"name":files::READ,"arguments":{"path":"x"}}),
        None,
        |_| panic!(),
    )
    .unwrap();
    assert_eq!(denied["isError"], true);
    assert_eq!(denied["structuredContent"]["code"], "not-authorized");
    assert!(files::call(
        &json!({"name":files::READ,"arguments":{"path":"x","extra":true}}),
        None,
        |_| {}
    )
    .is_err());
    assert!(files::tools()
        .iter()
        .all(|tool| tool["inputSchema"]["additionalProperties"] == false));
    assert_eq!(files::tools().len(), 5);
    // Creating never overwrites: it is not destructive.
    let create = files::tools()
        .into_iter()
        .find(|t| t["name"] == files::CREATE)
        .unwrap();
    assert_eq!(create["annotations"]["destructiveHint"], false);
    // Opening is read-only for the file: it shows a snapshot and never writes.
    let open = files::tools()
        .into_iter()
        .find(|t| t["name"] == files::OPEN)
        .unwrap();
    assert_eq!(open["annotations"]["readOnlyHint"], true);
}

#[test]
fn file_access_asks_by_default_and_catalog_preserves_unrelated_selections() {
    let scratch = Scratch::new();
    let dir = scratch.0.join("settings");
    assert_eq!(catalog::files_access(&dir), "ask");
    assert!(!catalog::files_enabled(&dir));
    catalog::connect_agents(&dir).unwrap();
    assert!(catalog::files_offered(&dir));
    catalog::set_enabled(&dir, "tldraw", true).unwrap();
    catalog::set_files_access(&dir, "always").unwrap();
    assert!(catalog::files_enabled(&dir));
    catalog::set_files_access(&dir, "off").unwrap();
    assert!(!catalog::files_enabled(&dir) && !catalog::files_offered(&dir));
    assert_eq!(catalog::files_access(&dir), "off");
    catalog::set_files_access(&dir, "ask").unwrap();
    assert_eq!(catalog::files_access(&dir), "ask");
    assert!(catalog::agents_connected(&dir));
    assert_eq!(catalog::enabled(&dir).len(), 1);
}
