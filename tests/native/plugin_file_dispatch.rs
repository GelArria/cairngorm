use super::super::{calls, file_runtime::TerminalFileScope, file_scope::ProjectScope};
use super::*;
#[path = "plugin_file_scope_fixture.rs"]
mod fixture;
struct Host;
impl ViewHost for Host {
    fn open(&self, _: &str, _: &PluginSpec, _: &calls::Call, _: &Value, _: &Value) {
        panic!("file tools must never create plugin views");
    }
    fn finished(&self, _: &str, _: &Result<Value, String>) {
        panic!();
    }
}
#[cfg(windows)]
#[test]
fn builtins_are_discoverable_without_remote_plugins_only_for_an_eligible_scope() {
    let scratch = fixture::Scratch::new();
    let scope = Arc::new(Scope {
        metadata: TerminalFileScope {
            session_id: "source".into(),
            project_id: "project".into(),
            root_path: scratch.root().to_string_lossy().into_owned(),
        },
        root: Arc::new(ProjectScope::new(&scratch.root()).unwrap()),
        epoch: "epoch".into(),
    });
    let caller = Caller {
        terminal: Some("source".into()),
        agent: None,
    };
    let list = dispatch(
        "tools/list",
        &json!({}),
        caller.clone(),
        &[],
        &Host,
        Some(scope.clone()),
        |_| panic!(),
    )
    .unwrap();
    let names: Vec<&str> = list["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            files::LIST,
            files::READ,
            files::OPEN,
            files::CREATE,
            files::OPERATE,
            apps::LIST,
            apps::RUN,
            app_mcp_tools::TOOLS,
            app_mcp_tools::CALL
        ]
    );
    let disabled = dispatch(
        "tools/list",
        &json!({}),
        caller.clone(),
        &[],
        &Host,
        None,
        |_| panic!(),
    )
    .unwrap();
    assert_eq!(disabled["tools"], json!([]));
    let context = dispatch(
        "resources/read",
        &json!({"uri":super::super::context::URI}),
        caller.clone(),
        &[],
        &Host,
        Some(scope.clone()),
        |_| panic!(),
    )
    .unwrap();
    let context: Value =
        serde_json::from_str(context["contents"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(
        context["files"]["tools"],
        json!([
            files::LIST,
            files::READ,
            files::OPEN,
            files::CREATE,
            files::OPERATE
        ])
    );
    assert_eq!(context["plugins"], json!([]));
    let initialized = dispatch(
        "initialize",
        &json!({}),
        caller,
        &[],
        &Host,
        Some(scope),
        |_| panic!(),
    )
    .unwrap();
    assert!(initialized["instructions"]
        .as_str()
        .unwrap()
        .contains("External paths need explicit"));
}
