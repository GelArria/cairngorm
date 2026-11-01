use super::{callers::Caller, calls, canvas, catalog::PluginSpec, mcp, view_requests};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

#[path = "plugin_lifecycle_fixture.rs"]
mod fixture;

struct Host<'a> {
    server: &'a fixture::Server,
    call: Mutex<Option<Arc<calls::Call>>>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}
impl mcp::ViewHost for Host<'_> {
    fn open(&self, id: &str, _: &PluginSpec, call: &calls::Call, _: &Value, _: &Value) {
        calls::view_event(call, "opened", Value::Null).unwrap();
        calls::view_event(call, "input", Value::Null).unwrap();
        let call = calls::get(id).unwrap();
        *self.worker.lock().unwrap() = Some(self.server.callback_worker(call.clone()));
        *self.call.lock().unwrap() = Some(call);
    }
    fn finished(&self, _: &str, outcome: &Result<Value, String>) {
        assert!(!outcome.as_ref().unwrap()["isError"]
            .as_bool()
            .unwrap_or(false));
        let call = self.call.lock().unwrap().as_ref().unwrap().clone();
        let result = view_requests::request(
            &call,
            &self.server.upstream,
            "tools/call",
            save("Initial shape"),
        )
        .unwrap();
        assert_ne!(result["isError"], true);
        assert!(canvas::snapshot(&call).is_some());
        // The server answered: the host may reload while model-context settlement is pending.
        view_requests::prepare_reload(&call, &self.server.upstream).unwrap();
        calls::view_event(
            &call,
            "context",
            json!({"structuredContent":{"shapes":[{"id":"shape:one"}]}}),
        )
        .unwrap();
    }
}
fn save(label: &str) -> Value {
    json!({"name":"save_checkpoint","arguments":{"canvasId":"canvas-A","checkpointId":"saved","shapesJson":json!([{"id":"shape:one","type":"geo","props":{"text":label}},{"id":"shape:arrow","type":"arrow","props":{"start":{"x":0,"y":0},"end":{"x":200,"y":0}}}]).to_string(),"bindingsJson":json!([{"type":"arrow","fromId":"shape:arrow","toId":"shape:one","props":{"terminal":"start","normalizedAnchor":{"x":0.5,"y":0.5},"isPrecise":false,"isExact":false},"meta":{}}]).to_string()}})
}

#[test]
fn an_app_callback_completes_pending_exec_and_reload_restores_the_acknowledged_edit() {
    let server = fixture::Server::new();
    let terminal = format!("native-reload-{}", uuid::Uuid::new_v4());
    let host = Host {
        server: &server,
        call: Mutex::default(),
        worker: Mutex::default(),
    };
    let result = mcp::dispatch(
        "tools/call",
        &json!({"name":"tldraw_exec","arguments":{"code":"fixture","canvasId":"canvas-A"}}),
        Caller {
            terminal: Some(terminal.clone()),
            agent: None,
        },
        &[(server.plugin, server.upstream.clone())],
        &host,
    )
    .unwrap();
    assert_ne!(result["isError"], true);
    host.worker.lock().unwrap().take().unwrap().join().unwrap();
    server.wait_for_exec();
    let call = host.call.lock().unwrap().as_ref().unwrap().clone();
    let saved = view_requests::request(
        &call,
        &server.upstream,
        "tools/call",
        save("Edited Ω label"),
    )
    .unwrap();
    assert_ne!(saved["isError"], true);
    view_requests::prepare_reload(&call, &server.upstream).unwrap();
    let prepared = call.prepared_view.lock().unwrap().take().unwrap();
    let restored = canvas::restore_html(&call, prepared["text"].as_str().unwrap()).unwrap();
    assert!(restored.contains("data-cairngorm-canvas="));
    assert_eq!(
        canvas::snapshot(&call).unwrap()["shapes"][0]["props"]["text"],
        "Edited Ω label"
    );
    let messages = server.messages();
    let saved = messages
        .iter()
        .rev()
        .find(|message| {
            message["method"] == "tools/call" && message["params"]["name"] == "save_checkpoint"
        })
        .unwrap();
    let bindings: Value = serde_json::from_str(
        saved["params"]["arguments"]["bindingsJson"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert!(
        bindings[0].get("id").is_none(),
        "deployed bindings deliberately omit record IDs"
    );
    assert_eq!(canvas::snapshot(&call).unwrap()["bindings"], bindings);
    let encoded = restored
        .split("data-cairngorm-canvas=\"")
        .nth(1)
        .unwrap()
        .split('"')
        .next()
        .unwrap();
    let restored_snapshot: Value =
        serde_json::from_slice(&STANDARD.decode(encoded).unwrap()).unwrap();
    assert_eq!(restored_snapshot["bindings"], bindings);
    let position = |name: &str| {
        messages
            .iter()
            .position(|m| m["method"] == "tools/call" && m["params"]["name"] == name)
            .unwrap()
    };
    assert!(
        position("exec") < position("_exec_callback"),
        "the callback must reach the server while exec is pending"
    );
    assert_eq!(
        messages
            .iter()
            .filter(|m| m["method"] == "tools/call" && m["params"]["name"] == "exec")
            .count(),
        1
    );
    let before = messages.len();
    assert!(view_requests::request(
        &call,
        &server.upstream,
        "tools/call",
        json!({"name":"exec","arguments":{}})
    )
    .is_err());
    assert!(view_requests::request(&call, &server.upstream, "pty_kill", json!({})).is_err());
    assert_eq!(
        server.messages().len(),
        before,
        "a view must not gain model or app privileges"
    );
    server.fail_save();
    let failed = view_requests::request(
        &call,
        &server.upstream,
        "tools/call",
        save("Unacknowledged edit"),
    )
    .unwrap();
    assert_eq!(failed["isError"], true);
    assert_eq!(
        canvas::snapshot(&call).unwrap()["shapes"][0]["props"]["text"],
        "Edited Ω label"
    );
    super::release_terminal(&terminal);
    assert!(canvas::snapshot(&call).is_none());
}

#[test]
fn reload_preparation_rejects_working_calls_or_unacknowledged_canvases() {
    let server = fixture::Server::new();
    let terminal = format!("native-reload-denied-{}", uuid::Uuid::new_v4());
    let (_, call) = calls::start(
        "tldraw",
        Some(terminal.clone()),
        None,
        json!({"_meta":{"ui":{"resourceUri":"ui://canvas/main"}}}),
    );
    canvas::bind(&call, &json!({"canvasId":"canvas-A"})).unwrap();
    assert!(view_requests::prepare_reload(&call, &server.upstream)
        .unwrap_err()
        .contains("working"));
    calls::complete(&call);
    assert!(view_requests::prepare_reload(&call, &server.upstream)
        .unwrap_err()
        .contains("No acknowledged"));
    assert!(
        server.messages().is_empty(),
        "rejected preparation must not reset or contact the upstream"
    );
    super::release_terminal(&terminal);
}
