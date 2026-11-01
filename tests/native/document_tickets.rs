use super::*;
use std::thread;

fn request(bytes: &[u8]) -> OpenRequest {
    OpenRequest {
        project: "project-a".into(),
        terminal: "term-1".into(),
        path: "C:/Project With Spaces/Review 日本語.docx".into(),
        bytes: bytes.to_vec(),
    }
}

#[test]
fn opening_waits_for_the_ui_and_serves_the_authorized_bytes() {
    let tickets = Arc::new(Tickets::default());
    let ui = tickets.clone();
    let (opened, view, _) = tickets
        .open(
            request(b"authorized"),
            move |announcement| {
                assert_eq!(announcement.name, "Review 日本語.docx");
                assert_eq!(announcement.project, "project-a");
                assert_eq!(announcement.size, 10);
                let ticket = announcement.ticket.clone();
                let ui = ui.clone();
                thread::spawn(move || {
                    assert_eq!(ui.read(&ticket).unwrap().as_slice(), b"authorized");
                    assert!(ui.acknowledge(
                        &ticket,
                        Ack::Opened("document".into(), serde_json::json!({}))
                    ));
                });
                Ok(())
            },
            Duration::from_secs(5),
        )
        .unwrap();
    assert_eq!(view, "document");
    assert_eq!(opened.sha256.len(), 64);
    // The pane keeps reading the same snapshot after the tool returned.
    assert_eq!(
        tickets.read(&opened.ticket).unwrap().as_slice(),
        b"authorized"
    );
}

#[test]
fn refusals_timeouts_and_failed_announcements_drop_the_ticket() {
    let tickets = Arc::new(Tickets::default());
    let ui = tickets.clone();
    let mut seen = String::new();
    let refused = tickets.open(
        request(b"x"),
        |announcement| {
            seen = announcement.ticket.clone();
            let ticket = seen.clone();
            let ui = ui.clone();
            thread::spawn(move || {
                ui.acknowledge(&ticket, Ack::Failed("No source terminal".into()))
            });
            Ok(())
        },
        Duration::from_secs(5),
    );
    assert_eq!(refused.unwrap_err(), "No source terminal");
    assert!(tickets.read(&seen).is_none());

    let mut late = String::new();
    let timed_out = tickets.open(
        request(b"y"),
        |announcement| {
            late = announcement.ticket.clone();
            Ok(())
        },
        Duration::from_millis(50),
    );
    assert!(timed_out.unwrap_err().contains("in time"));
    assert!(tickets.read(&late).is_none());
    // A late acknowledgement cannot revive a closed request.
    assert!(!tickets.acknowledge(&late, Ack::Opened("document".into(), serde_json::json!({}))));

    let failed = tickets.open(
        request(b"z"),
        |_| Err("no window".into()),
        Duration::from_secs(1),
    );
    assert_eq!(failed.unwrap_err(), "no window");
}

#[test]
fn unknown_tickets_cannot_be_read_or_acknowledged() {
    let tickets = Tickets::default();
    assert!(tickets.read("missing").is_none());
    assert!(!tickets.acknowledge(
        "missing",
        Ack::Opened("editor".into(), serde_json::json!({}))
    ));
}
