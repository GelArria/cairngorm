use super::super::file_runtime::TerminalFileScope;
use super::*;
#[path = "plugin_file_scope_fixture.rs"]
mod fixture;

#[cfg(windows)]
#[test]
fn expired_cancelled_and_invalid_approvals_never_persist_grants() {
    let scratch = fixture::Scratch::new();
    let root = Arc::new(ProjectScope::new(&scratch.root()).unwrap());
    let scope = Arc::new(Scope {
        metadata: TerminalFileScope {
            session_id: "scope".into(),
            project_id: "project".into(),
            root_path: scratch.root().to_string_lossy().into_owned(),
        },
        root,
        epoch: "epoch".into(),
    });
    let path = scope.root.resolve("../outside/secret.txt").unwrap();
    let mut permissions = Permissions::default();
    let (id, receiver) = permissions
        .request(scope.clone(), path.clone(), false)
        .unwrap();
    permissions.pending.get_mut(&id).unwrap().created -= TIMEOUT;
    assert!(permissions.reply(&id, Decision::Folder).is_err());
    assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
    assert!(permissions.granted(&scope, &path).is_none());
    let (id, receiver) = permissions
        .request(scope.clone(), path.clone(), false)
        .unwrap();
    drop(receiver);
    assert!(permissions.reply(&id, Decision::File).is_err());
    assert!(permissions.granted(&scope, &path).is_none());
    let (id, receiver) = permissions
        .request(scope.clone(), path.parent().unwrap().to_path_buf(), true)
        .unwrap();
    assert!(permissions.reply(&id, Decision::File).is_err());
    assert!(receiver.recv_timeout(Duration::from_millis(100)).is_err());
    assert!(permissions.granted(&scope, &path).is_none());
}
