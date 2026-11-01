use super::*;
use serde_json::json;
use std::net::TcpListener;

#[test]
fn a_cancellation_reaches_only_the_matching_request_on_this_thread() {
    assert!(current().is_none());
    let guard = begin(Some("101"), &json!(7), None);
    let token = current().expect("registered");
    cancel(Some("202"), &json!(7));
    cancel(Some("101"), &json!(8));
    assert!(!token.cancelled(), "other clients and ids are untouched");
    cancel(Some("101"), &json!(7));
    assert!(token.cancelled());
    drop(guard);
    assert!(current().is_none());
    // A late cancellation for a finished request is ignored.
    cancel(Some("101"), &json!(7));
}

#[test]
fn a_client_that_hangs_up_cancels_its_request() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let client = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (server, _) = listener.accept().unwrap();
    let token = Token::new(
        Arc::new(AtomicBool::new(false)),
        Some(server.try_clone().unwrap()),
    );
    // Checked at most once a second; a live, quiet client is not a hang-up.
    *token.checked.lock().unwrap() -= Duration::from_secs(2);
    assert!(!token.cancelled());
    drop(client);
    std::thread::sleep(Duration::from_millis(100));
    *token.checked.lock().unwrap() -= Duration::from_secs(2);
    assert!(token.cancelled());
    // The connection is left blocking for the reply.
    server
        .set_read_timeout(Some(Duration::from_millis(10)))
        .unwrap();
}
