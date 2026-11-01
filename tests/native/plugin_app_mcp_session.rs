use super::super::app_cancel;
use super::*;

/// A minimal stdio MCP server: it pings the client before answering, echoes calls, fails
/// "boom" and exits on "quit".
const SERVER: &str = r#"
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let pinged = false;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === 'ping-1') { pinged = m.result !== undefined; return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') {
    send({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' });
    return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake' } } });
  }
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } });
  if (m.params && m.params.name === 'boom') return send({ jsonrpc: '2.0', id: m.id, error: { code: -1, message: 'boom failed' } });
  if (m.params && m.params.name === 'quit') process.exit(0);
  if (m.params && m.params.name === 'hang') return;
  if (m.params && m.params.name === 'garbage') return process.stdout.write(Buffer.from([0xff, 0xfe, 0x0a]));
  if (m.params && m.params.name === 'deaf') { rl.close(); process.stdin.pause(); return; }
  send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify({ args: m.params.arguments, pinged, cwd: process.cwd() }) }] } });
});
"#;

fn fake() -> (McpServer, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("cairngorm-mcp-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let script = dir.join("server.js");
    std::fs::write(&script, SERVER).unwrap();
    let node = crate::cli_catalog::find_program("node").expect("node is installed");
    (
        McpServer {
            program: node.to_string_lossy().into(),
            args: vec![script.to_string_lossy().into()],
        },
        dir,
    )
}

#[test]
fn talks_to_an_application_server_over_stdio() {
    let (server, dir) = fake();
    let session = Session::start(&server, &dir).expect("initialized");
    assert!(session.alive() && session.serves(&server));
    let list = session
        .request("tools/list", json!({}), Duration::from_secs(10))
        .unwrap();
    assert_eq!(list["tools"][0]["name"], "echo");
    let reply = session
        .request(
            "tools/call",
            json!({"name": "echo", "arguments": {"x": 1}}),
            Duration::from_secs(10),
        )
        .unwrap();
    let text: Value = serde_json::from_str(reply["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(text["args"], json!({"x": 1}));
    // The server's own request was answered, and it ran in the project folder.
    assert_eq!(text["pinged"], true);
    assert_eq!(
        std::path::Path::new(text["cwd"].as_str().unwrap())
            .canonicalize()
            .unwrap(),
        dir.canonicalize().unwrap()
    );
    let error = session
        .request(
            "tools/call",
            json!({"name": "boom"}),
            Duration::from_secs(10),
        )
        .unwrap_err()
        .to_string();
    assert_eq!(error, "boom failed");
    drop(session);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_server_that_does_not_answer_is_retired() {
    let (server, dir) = fake();
    let session = Session::start(&server, &dir).expect("initialized");
    let error = session
        .request(
            "tools/call",
            json!({"name": "hang"}),
            Duration::from_millis(300),
        )
        .unwrap_err()
        .to_string();
    assert!(error.contains("did not answer"), "{error}");
    assert!(
        !session.alive(),
        "a timed-out server is replaced on next use"
    );
    drop(session);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn unreadable_output_ends_the_session_at_once() {
    let (server, dir) = fake();
    let session = Session::start(&server, &dir).expect("initialized");
    let started = std::time::Instant::now();
    let error = session
        .request(
            "tools/call",
            json!({"name": "garbage"}),
            Duration::from_secs(20),
        )
        .unwrap_err()
        .to_string();
    assert!(error.contains("stopped"), "{error}");
    assert!(!session.alive());
    // Later requests fail immediately instead of waiting out their timeout.
    let error = session
        .request("tools/list", json!({}), Duration::from_secs(20))
        .unwrap_err()
        .to_string();
    assert!(error.contains("stopped"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(10));
    drop(session);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_server_that_stops_reading_never_blocks_past_the_timeout() {
    let (server, dir) = fake();
    let session = Session::start(&server, &dir).expect("initialized");
    let _ = session.request(
        "tools/call",
        json!({"name": "deaf"}),
        Duration::from_millis(500),
    );
    // Far larger than any pipe buffer: a blocking write would hang here forever.
    let big = "x".repeat(8 * 1024 * 1024);
    let started = std::time::Instant::now();
    assert!(session
        .request(
            "tools/call",
            json!({"name": "echo", "arguments": {"big": big}}),
            Duration::from_secs(1)
        )
        .is_err());
    assert!(started.elapsed() < Duration::from_secs(5));
    drop(session);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_server_that_exits_fails_the_waiting_request_without_hanging() {
    let (server, dir) = fake();
    let session = Session::start(&server, &dir).expect("initialized");
    let started = std::time::Instant::now();
    let error = session
        .request(
            "tools/call",
            json!({"name": "quit"}),
            Duration::from_secs(20),
        )
        .unwrap_err()
        .to_string();
    assert!(error.contains("stopped"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(10));
    std::thread::sleep(Duration::from_millis(200));
    assert!(!session.alive());
    drop(session);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_cancelled_request_stops_at_once_and_the_server_stays_in_use() {
    let (server, dir) = fake();
    let session = Session::start(&server, &dir).expect("initialized");
    let id = json!("cancel-me");
    let _request = app_cancel::begin(Some("test-client"), &id, None);
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        app_cancel::cancel(Some("test-client"), &json!("cancel-me"));
    });
    let started = std::time::Instant::now();
    let error = session
        .request(
            "tools/call",
            json!({"name": "hang"}),
            Duration::from_secs(20),
        )
        .unwrap_err();
    canceller.join().unwrap();
    assert_eq!(error, Failure::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(
        session.alive(),
        "a cancelled request does not end the server"
    );
    let list = session
        .request("tools/list", json!({}), Duration::from_secs(10))
        .unwrap();
    assert_eq!(list["tools"][0]["name"], "echo");
    drop(session);
    let _ = std::fs::remove_dir_all(dir);
}
