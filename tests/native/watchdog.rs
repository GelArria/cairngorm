// The watchdog closes Cairngorm with every terminal and agent: only a real freeze may do that.
use super::{heartbeat_hang, recovered, HANG_THRESHOLD_SECS};

const LATE: i64 = HANG_THRESHOLD_SECS as i64;

#[test]
fn a_throttled_heartbeat_with_fresh_pongs_is_not_a_freeze() {
    // A minimized or covered window: timers run about once a minute, events still answer.
    assert!(!heartbeat_hang(LATE + 30, 3));
    assert!(!heartbeat_hang(LATE, 15));
}

#[test]
fn a_late_heartbeat_and_a_stale_pong_is_a_freeze() {
    assert!(heartbeat_hang(LATE, 16));
    assert!(heartbeat_hang(LATE * 2, LATE * 2));
    assert!(!heartbeat_hang(LATE - 1, LATE));
}

#[test]
fn a_pong_after_the_dialog_counts_as_recovery() {
    let hang = 1_000;
    // Heartbeat still throttled, but the webview answered a ping: it must stay open.
    assert!(recovered(hang, hang - 50, hang + 2));
    assert!(recovered(hang, hang + 1, hang - 20));
    assert!(!recovered(hang, hang, hang));
}
