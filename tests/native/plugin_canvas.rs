use super::*;

fn call(terminal: &str, canvas: &str) -> std::sync::Arc<Call> {
    let (_, call) = calls::start(
        "tldraw",
        Some(terminal.into()),
        None,
        json!({"_meta":{"ui":{"resourceUri":"ui://canvas/main"}}}),
    );
    bind(&call, &json!({"canvasId":canvas})).unwrap();
    call
}
fn args(canvas: &str, label: &str) -> Value {
    json!({"canvasId":canvas,"checkpointId":"checkpoint-latest","shapesJson":json!([{"id":"shape:one","type":"geo","props":{"text":label}}]).to_string()})
}
fn html(canvas: &str) -> String {
    let bootstrap = json!({"canvasId":canvas,"sessionId":"fresh-session","mcpSessionId":"fresh-transport","methodMap":{"keep":true},"checkpointId":"old","shapes":[]});
    format!(
        "<html><script>{BOOTSTRAP}{}\"));</script></html>",
        STANDARD.encode(bootstrap.to_string())
    )
}

#[test]
fn acknowledged_checkpoints_are_isolated_and_never_inferred_from_exec_results() {
    let terminal = format!("canvas-memory-{}", uuid::Uuid::new_v4());
    let other = format!("canvas-memory-{}", uuid::Uuid::new_v4());
    let first = call(&terminal, "canvas-A");
    let second = call(&terminal, "canvas-B");
    let foreign = call(&other, "canvas-A");
    assert!(ensure_reloadable(&first).is_err());
    bind(
        &first,
        &json!({"canvasId":"canvas-A","checkpointId":"not-an-ack"}),
    )
    .unwrap();
    assert!(snapshot(&first).is_none());
    acknowledge(
        &first,
        checkpoint(&first, &args("canvas-A", "Saved Ω"))
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        snapshot(&first).unwrap()["shapes"][0]["props"]["text"],
        "Saved Ω"
    );
    assert!(snapshot(&second).is_none());
    assert!(snapshot(&foreign).is_none());
    assert!(checkpoint(&first, &args("canvas-B", "Wrong canvas")).is_err());
    assert!(bind(&first, &json!({"canvasId":"canvas-B"})).is_err());
    super::super::release_terminal(&terminal);
    super::super::release_terminal(&other);
}

#[test]
fn recovery_overlays_only_snapshot_data_and_rejects_changed_bootstrap_contracts() {
    let terminal = format!("canvas-html-{}", uuid::Uuid::new_v4());
    let call = call(&terminal, "canvas-A");
    let payload = args("canvas-A", "Ω </script><script>bad()</script>");
    acknowledge(&call, checkpoint(&call, &payload).unwrap().unwrap()).unwrap();
    let source = html("canvas-A");
    let restored = restore_html(&call, &source).unwrap();
    assert!(
        restored.starts_with(&source),
        "fresh session/transport/bootstrap remain verbatim"
    );
    assert!(restored.contains("data-cairngorm-canvas="));
    assert!(!restored.contains("<script>bad()"));
    assert!(restore_html(&call, &html("canvas-B")).is_err());
    assert!(restore_html(&call, "<html>contract changed</html>").is_err());
    let missing_canvas =
        STANDARD.encode(json!({"sessionId":"fresh","mcpSessionId":"fresh-transport"}).to_string());
    let missing_canvas = format!("<script>{BOOTSTRAP}{missing_canvas}\"));</script>");
    assert!(restore_html(&call, &missing_canvas)
        .unwrap_err()
        .contains("has no canvasId"));
    super::super::release_terminal(&terminal);
}

#[test]
fn malformed_or_oversized_records_do_not_replace_acknowledged_state() {
    let terminal = format!("canvas-validation-{}", uuid::Uuid::new_v4());
    let call = call(&terminal, "canvas-A");
    acknowledge(
        &call,
        checkpoint(&call, &args("canvas-A", "Keep"))
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    for invalid in [
        json!({}),
        json!(null),
        json!([{"id":"shape:no-type"}]),
        json!(["not-a-record"]),
    ] {
        let mut value = args("canvas-A", "Bad");
        value["shapesJson"] = json!(invalid.to_string());
        assert!(checkpoint(&call, &value).is_err());
    }
    for invalid in [
        json!({"id":"binding:id-only"}),
        json!({"type":"arrow","fromId":"shape:arrow","toId":42}),
        json!({"type":"arrow","fromId":"shape:arrow","toId":"shape:one","props":[]}),
    ] {
        let mut value = args("canvas-A", "Bad binding");
        value["bindingsJson"] = Value::String(json!([invalid]).to_string());
        assert!(checkpoint(&call, &value).is_err());
    }
    let mut value = args("canvas-A", "Bad");
    value["shapesJson"] = json!(" ".repeat(MAX_CHECKPOINT + 1));
    assert!(checkpoint(&call, &value).is_err());
    assert_eq!(
        snapshot(&call).unwrap()["shapes"][0]["props"]["text"],
        "Keep"
    );
    super::super::release_terminal(&terminal);
}

#[test]
fn source_closure_revokes_even_an_already_in_flight_save() {
    let terminal = format!("canvas-revocation-{}", uuid::Uuid::new_v4());
    let call = call(&terminal, "canvas-A");
    let pending = checkpoint(&call, &args("canvas-A", "Late save"))
        .unwrap()
        .unwrap();
    super::super::release_terminal(&terminal);
    assert!(acknowledge(&call, pending).unwrap_err().contains("closed"));
    assert!(snapshot(&call).is_none());
    assert!(
        calls::view_event(&call, "context", json!({"structuredContent":{"shapes":[]}})).is_err()
    );
}

#[test]
fn an_empty_context_is_not_a_flush_acknowledgement_for_an_existing_checkpoint() {
    let terminal = format!("canvas-empty-{}", uuid::Uuid::new_v4());
    let call = call(&terminal, "canvas-A");
    calls::view_event(&call, "input", Value::Null).unwrap();
    calls::view_event(&call, "context", json!({"structuredContent":{"shapes":[]}})).unwrap();
    assert!(empty_without_checkpoint(&call));
    acknowledge(
        &call,
        checkpoint(&call, &args("canvas-A", "Keep saved"))
            .unwrap()
            .unwrap(),
    )
    .unwrap();
    assert!(!empty_without_checkpoint(&call));
    super::super::release_terminal(&terminal);
}
