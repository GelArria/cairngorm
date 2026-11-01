use super::*;

#[test]
fn preview_only_accepts_web_addresses_without_embedded_credentials() {
    for value in [
        "http://localhost:3000",
        "https://example.com/checkout",
        "http://[::1]:8080",
    ] {
        assert!(parse_url(Some(value.into())).is_ok());
    }
    for value in [
        "javascript:alert(1)",
        "file:///C:/secret",
        "tauri://localhost",
        "data:text/html,test",
        "https://user:password@example.com",
        "localhost:3000",
    ] {
        assert!(parse_url(Some(value.into())).is_err(), "{value}");
    }
    assert!(parse_url(None).is_err());
}

#[test]
fn bounds_reject_nonfinite_negative_and_unbounded_geometry() {
    let mut bounds = Bounds {
        x: 5.0,
        y: 50.0,
        width: 800.0,
        height: 600.0,
    };
    assert!(bounds.valid());
    bounds.width = f64::NAN;
    assert!(!bounds.valid());
    bounds.width = 17000.0;
    assert!(!bounds.valid());
    bounds.width = 0.0;
    assert!(!bounds.valid());
    bounds.width = 800.0;
    bounds.x = -1.0;
    assert!(!bounds.valid());
}
