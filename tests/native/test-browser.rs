use super::*;
use std::{
    io::Write,
    net::{TcpListener, TcpStream},
};

fn request(raw: &str) -> Result<(String, Vec<u8>), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let raw = raw.to_string();
    let sender = std::thread::spawn(move || {
        let mut client = TcpStream::connect(address).unwrap();
        client.write_all(raw.as_bytes()).unwrap();
    });
    let (mut stream, _) = listener.accept().unwrap();
    let result = http::read_request(&mut stream);
    sender.join().unwrap();
    result
}

#[test]
fn reads_authenticated_body_without_requiring_a_browser_origin() {
    let (token, body) = request(
        "POST /frame HTTP/1.1\r\nAuthorization: Bearer session-key\r\nContent-Length: 2\r\n\r\n{}",
    )
    .unwrap();
    assert_eq!(token, "session-key");
    assert_eq!(body, b"{}");
}

#[test]
fn rejects_browser_requests_missing_auth_and_unbounded_bodies() {
    for headers in [
        "Content-Length: 2",
        "Authorization: Bearer key\r\nContent-Length: 2000001",
        "Authorization: Bearer key\r\nContent-Length: 2\r\nOrigin: http://untrusted.example",
        "Authorization: Bearer key\r\nTransfer-Encoding: chunked",
        "Authorization: Bearer key\r\nContent-Length: 2\r\nContent-Length: 2",
    ] {
        assert!(request(&format!("POST /frame HTTP/1.1\r\n{headers}\r\n\r\n{{}}")).is_err());
    }
}

#[test]
fn rejects_incomplete_and_oversized_headers() {
    assert!(request("POST /frame HTTP/1.1\r\n").is_err());
    assert!(request(&format!(
        "POST /frame HTTP/1.1\r\nX-Large: {}\r\n",
        "a".repeat(8192)
    ))
    .is_err());
}

#[test]
fn decodes_binary_frames_without_base64_and_rejects_truncated_envelopes() {
    let metadata = serde_json::to_vec(
        &serde_json::json!({ "type": "frame", "pageId": "p1", "timestamp": 1,
        "width": 800, "height": 600 }),
    )
    .unwrap();
    let mut body = (metadata.len() as u32).to_be_bytes().to_vec();
    body.extend(&metadata);
    body.extend([0xff, 0xd8, 0xff, 0xd9]);
    let (event, jpeg) = decode_event(&body).unwrap();
    assert!(valid_frame_metadata(&event));
    assert!(event.image.is_none());
    assert_eq!(jpeg, [0xff, 0xd8, 0xff, 0xd9]);
    assert!(decode_event(&body[..metadata.len()]).is_none());
    assert!(decode_event(&u32::MAX.to_be_bytes()).is_none());
    assert!(decode_event(&[0, 0]).is_none());
}

#[test]
fn validates_frame_and_closed_messages() {
    let mut event: BrowserEvent = serde_json::from_value(serde_json::json!({
        "type": "frame", "pageId": "p1", "timestamp": 1, "image": "/9j/AA==", "width": 800, "height": 600
    })).unwrap();
    assert!(valid(&event));
    event.width = Some(0);
    assert!(!valid(&event));
    event.width = Some(800);
    event.image = Some("<script>".into());
    assert!(!valid(&event));
    event.kind = "closed".into();
    event.image = None;
    assert!(valid(&event));
    event.kind = "navigate".into();
    assert!(!valid(&event));
}

#[test]
fn validates_activity_messages_and_serializes_their_fields() {
    let mut event: BrowserEvent = serde_json::from_value(serde_json::json!({
        "type": "activity", "pageId": "p1", "timestamp": 20, "startedAt": 10,
        "activityId": "a1", "status": "completed", "label": "Click · Checkout"
    }))
    .unwrap();
    assert!(valid(&event));
    let value = serde_json::to_value(&event).unwrap();
    assert_eq!(value["activityId"], "a1");
    assert_eq!(value["startedAt"], 10);
    event.status = Some("invalid".into());
    assert!(!valid(&event));
    event.status = Some("running".into());
    event.started_at = Some(21);
    assert!(!valid(&event));
    event.started_at = Some(10);
    event.label = Some("x".repeat(513));
    assert!(!valid(&event));
}

#[test]
fn preserves_and_validates_engine_and_project_metadata() {
    let mut event: BrowserEvent = serde_json::from_value(serde_json::json!({
        "type": "frame", "pageId": "p1", "timestamp": 1, "image": "/9j/AA==", "width": 800, "height": 600,
        "browserName": "firefox", "projectName": "Mobile checkout"
    })).unwrap();
    assert!(valid(&event));
    assert_eq!(
        serde_json::to_value(&event).unwrap()["browserName"],
        "firefox"
    );
    event.browser_name = Some("unknown".into());
    assert!(!valid(&event));
    event.browser_name = Some("webkit".into());
    event.project_name = Some("x".repeat(513));
    assert!(!valid(&event));
}
