use super::*;
use std::sync::{atomic::AtomicBool, Arc};

fn dialog(text: &str) -> Observation {
    Observation {
        dialog: Some(text.into()),
        hung: false,
        observed: true,
    }
}

#[test]
fn a_dialog_that_stays_stops_the_request_with_its_text() {
    let mut watch = Watch::new(Duration::from_secs(120), None);
    let t0 = Instant::now();
    assert_eq!(watch.check(t0, Some(&dialog("Save? [Yes] [No]"))), None);
    assert_eq!(
        watch.check(
            t0 + Duration::from_secs(3),
            Some(&dialog("Save? [Yes] [No]"))
        ),
        None
    );
    assert_eq!(
        watch.check(
            t0 + Duration::from_secs(4),
            Some(&dialog("Save? [Yes] [No]"))
        ),
        Some(Stop::Dialog("Save? [Yes] [No]".into()))
    );
}

#[test]
fn passing_or_changing_dialogs_restart_the_count() {
    let mut watch = Watch::new(Duration::from_secs(120), None);
    let t0 = Instant::now();
    let s = |secs| t0 + Duration::from_secs(secs);
    watch.check(s(0), Some(&dialog("Working")));
    watch.check(s(3), Some(&Observation::default()));
    assert_eq!(watch.check(s(5), Some(&dialog("Working"))), None);
    assert_eq!(watch.check(s(8), Some(&dialog("Other"))), None);
    // Between scans the last observation stands.
    assert_eq!(watch.check(s(11), None), None);
    assert_eq!(watch.check(s(12), None), Some(Stop::Dialog("Other".into())));
}

#[test]
fn a_busy_application_is_never_stopped_before_its_time_limit() {
    let mut watch = Watch::new(Duration::from_secs(60), None);
    let t0 = Instant::now();
    let hung = Observation {
        dialog: None,
        hung: true,
        observed: true,
    };
    // A long COM call keeps the UI thread busy: Windows calls it hung, but it works.
    assert_eq!(watch.check(t0, Some(&hung)), None);
    assert_eq!(watch.check(t0 + Duration::from_secs(59), Some(&hung)), None);
    assert_eq!(
        watch.check(t0 + Duration::from_secs(60), None),
        Some(Stop::TimedOut {
            hung: true,
            observed: true
        })
    );
}

#[test]
fn time_limit_and_cancellation_stop_the_request() {
    let mut watch = Watch::new(Duration::from_secs(5), None);
    let t0 = Instant::now();
    assert_eq!(watch.check(t0 + Duration::from_secs(4), None), None);
    assert_eq!(
        watch.check(t0 + Duration::from_secs(5), None),
        Some(Stop::TimedOut {
            hung: false,
            observed: false
        })
    );
    let flag = Arc::new(AtomicBool::new(false));
    let mut watch = Watch::new(
        Duration::from_secs(60),
        Some(Token::new(flag.clone(), None)),
    );
    assert_eq!(watch.check(Instant::now(), None), None);
    flag.store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(watch.check(Instant::now(), None), Some(Stop::Cancelled));
}

#[test]
fn limits_are_kept_between_five_seconds_and_four_minutes() {
    assert_eq!(limit(None), Duration::from_secs(120));
    assert_eq!(limit(Some(1)), Duration::from_secs(5));
    assert_eq!(limit(Some(30)), Duration::from_secs(30));
    assert_eq!(limit(Some(100_000)), Duration::from_secs(240));
}

#[test]
fn messages_tell_the_agent_what_to_do() {
    let limit = Duration::from_secs(60);
    assert!(Stop::Dialog("Save?".into())
        .message("Word", limit)
        .contains("\u{201c}Save?\u{201d}"));
    assert!(Stop::TimedOut {
        hung: false,
        observed: true
    }
    .message("Word", limit)
    .contains("60 s"));
    assert!(Stop::TimedOut {
        hung: true,
        observed: true
    }
    .message("Word", limit)
    .contains("still busy"));
    assert!(Stop::Dialog("x".into())
        .message("Word", limit)
        .contains("left open"));
    assert_eq!(Stop::Dialog(String::new()).code(), "app-dialog");
}

/// A real message box from another process is found, with its text and buttons.
#[cfg(windows)]
#[test]
fn a_real_message_box_is_seen_with_its_text() {
    let mut child = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('The file is locked by another user.', 'Cairngorm watch test', 'OKCancel')",
        ])
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut seen = Observation::default();
    while Instant::now() < deadline {
        seen = win::observe(&[child.id()]);
        if seen.dialog.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let _ = child.kill();
    let _ = child.wait();
    let text = seen.dialog.expect("the message box is observed");
    assert!(text.contains("Cairngorm watch test"), "{text}");
    assert!(
        text.contains("The file is locked by another user."),
        "{text}"
    );
    assert!(text.contains("[OK]") && text.contains("[Cancel]"), "{text}");
    assert!(!seen.hung);
}

#[test]
fn where_windows_cannot_be_seen_a_timeout_says_a_prompt_may_be_waiting() {
    let unobserved = Stop::TimedOut {
        hung: false,
        observed: false,
    };
    let message = unobserved.message("Keynote", Duration::from_secs(30));
    assert!(
        message.contains("cannot see") && message.contains("may control Keynote"),
        "{message}"
    );
    let mut watch = Watch::new(Duration::from_secs(5), None);
    let t0 = Instant::now();
    watch.check(t0, Some(&Observation::default()));
    assert_eq!(
        watch.check(t0 + Duration::from_secs(5), None),
        Some(unobserved)
    );
}
