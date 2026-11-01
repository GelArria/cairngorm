use super::*;
use serde_json::json;
use std::{sync::Arc, thread};

#[test]
fn answers_reach_the_waiting_request_once() {
    let requests = Arc::new(Requests::default());
    let ui = requests.clone();
    let result = requests.run(
        move |id| {
            let id = id.to_string();
            thread::spawn(move || {
                assert!(ui.complete(&id, Ok(json!({ "value": 1 }))));
                assert!(!ui.complete(&id, Ok(json!({ "value": 2 }))));
            });
            Ok(())
        },
        Duration::from_secs(5),
    );
    assert_eq!(result.unwrap(), json!({ "value": 1 }));
}

#[test]
fn errors_timeouts_and_late_answers() {
    let requests = Arc::new(Requests::default());
    let ui = requests.clone();
    let failed = requests.run(
        move |id| {
            let id = id.to_string();
            thread::spawn(move || ui.complete(&id, Err("No open document.".into())));
            Ok(())
        },
        Duration::from_secs(5),
    );
    assert_eq!(failed.unwrap_err(), "No open document.");
    let mut late = String::new();
    let timed_out = requests.run(
        |id| {
            late = id.to_string();
            Ok(())
        },
        Duration::from_millis(30),
    );
    assert!(timed_out.unwrap_err().contains("in time"));
    assert!(!requests.complete(&late, Ok(json!(null))));
    assert!(!requests.complete("never-issued", Ok(json!(null))));
    assert_eq!(
        requests
            .run(|_| Err("no window".into()), Duration::from_secs(1))
            .unwrap_err(),
        "no window"
    );
}
