use super::*;
fn event(kind: &str, id: &str) -> BrowserEvent {
    serde_json::from_value(serde_json::json!({ "type": kind, "pageId": id, "timestamp": 1 }))
        .unwrap()
}

#[test]
fn coalesces_video_and_preserves_the_last_frame_before_close() {
    let mut queue = Queue::default();
    for _ in 0..100 {
        queue.push(event("frame", "page"));
    }
    queue.push(event("closed", "page"));
    queue.push(event("frame", "page"));
    assert_eq!(queue.events.len(), 2);
    assert_eq!(queue.events[0].kind, "frame");
    assert_eq!(queue.events[1].kind, "closed");
}

#[test]
fn bounds_pending_pages_when_the_window_cannot_process_events() {
    let mut queue = Queue::default();
    for n in 0..100 {
        queue.push(event("frame", &n.to_string()));
    }
    assert_eq!(queue.events.len(), 24);
}
