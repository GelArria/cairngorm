use crate::{ai_detection, ai_usage, ai_usage_parse};

/// Before every reset time used below.
const NOW: i64 = 1_791_000_000;

#[test]
fn claude_subscription_login_shows_its_plan() {
    let out = r#"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro"}"#;
    let login = ai_detection::parse_claude_login(true, out).unwrap();
    assert_eq!(login.plan.as_deref(), Some("pro"));
    assert!(login.subscription);
}

#[test]
fn claude_api_login_is_not_a_subscription() {
    let out = r#"{"loggedIn":true,"authMethod":"api_key","subscriptionType":""}"#;
    let login = ai_detection::parse_claude_login(true, out).unwrap();
    assert_eq!(login.plan, None);
    assert!(!login.subscription);
}

#[test]
fn claude_signed_out_or_failed_status_has_no_login() {
    assert!(ai_detection::parse_claude_login(true, r#"{"loggedIn":false}"#).is_none());
    assert!(ai_detection::parse_claude_login(false, r#"{"loggedIn":true}"#).is_none());
    assert!(ai_detection::parse_claude_login(true, "not json").is_none());
}

#[test]
fn codex_rate_limits_are_ordered_session_first() {
    let result = serde_json::json!({"rateLimits": {
        "planType": "pro",
        "primary": {"usedPercent": 41, "windowDurationMins": 10080, "resetsAt": 1792675200},
        "secondary": {"usedPercent": 7.5, "windowDurationMins": 300, "resetsAt": 1792000000}
    }});
    let usage = ai_usage_parse::parse_codex(&result, NOW).unwrap();
    let windows = usage.windows;
    assert_eq!(usage.plan.as_deref(), Some("pro"));
    assert_eq!(usage.warning, None);
    assert_eq!(windows[0].label, "5-hour");
    assert_eq!(windows[0].used_percent, 7.5);
    assert_eq!(windows[1].label, "Weekly");
    assert_eq!(windows[1].resets_at, Some(1792675200));
}

#[test]
fn codex_weekly_only_plan_has_one_window() {
    let result = serde_json::json!({"rateLimits": {
        "planType": "plus",
        "primary": {"usedPercent": 41, "windowDurationMins": 10080, "resetsAt": 1792675200},
        "secondary": null
    }});
    let windows = ai_usage_parse::parse_codex(&result, NOW).unwrap().windows;
    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0].kind, "weekly");
    assert!(ai_usage_parse::parse_codex(&serde_json::json!({"rateLimits": {}}), NOW).is_err());
    let odd = serde_json::json!({"rateLimits": {
        "primary": {"usedPercent": 5, "windowDurationMins": 0},
        "secondary": {"usedPercent": 5, "windowDurationMins": 90}
    }});
    let windows = ai_usage_parse::parse_codex(&odd, NOW).unwrap().windows;
    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0].label, "90-minute");
}

#[test]
fn codex_window_past_its_reset_reads_as_reset() {
    // The account was read after the 5-hour window ended but before Codex refreshed it.
    let result = serde_json::json!({"rateLimits": {
        "primary": {"usedPercent": 88, "windowDurationMins": 300, "resetsAt": NOW - 60},
        "secondary": {"usedPercent": 40, "windowDurationMins": 10080, "resetsAt": NOW + 3600}
    }});
    let windows = ai_usage_parse::parse_codex(&result, NOW).unwrap().windows;
    assert_eq!(windows[0].used_percent, 0.0);
    assert_eq!(windows[0].resets_at, None);
    assert_eq!(windows[1].used_percent, 40.0);
    assert_eq!(windows[1].resets_at, Some(NOW + 3600));
}

#[test]
fn codex_blocked_usage_is_a_warning_even_below_full_windows() {
    let window = serde_json::json!({"usedPercent": 60, "windowDurationMins": 300});
    let reached = serde_json::json!({"rateLimits": {
        "primary": window, "rateLimitReachedType": "rate_limit_reached"
    }});
    let warning = ai_usage_parse::parse_codex(&reached, NOW).unwrap().warning;
    assert!(warning.unwrap().contains("usage limit is reached"));
    let spend = serde_json::json!({"rateLimits": {
        "primary": window, "spendControlReached": true, "rateLimitReachedType": null
    }});
    let warning = ai_usage_parse::parse_codex(&spend, NOW).unwrap().warning;
    assert!(warning.unwrap().contains("Spend limit"));
    // The shape Codex 0.166 returns for an account within its limits.
    let fine = serde_json::json!({"rateLimits": {
        "primary": window, "spendControlReached": false, "rateLimitReachedType": null
    }});
    assert_eq!(
        ai_usage_parse::parse_codex(&fine, NOW).unwrap().warning,
        None
    );
}

/// Live check against the installed CLIs: `cargo test ai_usage_live -- --ignored --nocapture`.
#[test]
#[ignore]
fn ai_usage_live() {
    for id in ["codex", "claude"] {
        let report = ai_usage::report(id, Default::default());
        println!("{id}: {}", serde_json::to_string(&report).unwrap());
    }
}
