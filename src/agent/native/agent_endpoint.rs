/// Keep local development and internal HTTP/WS gateways configurable.
pub fn validate_base_url(value: &str) -> Result<String, String> {
    let base = value.trim().trim_end_matches('/');
    if base.len() > 8192 {
        return Err("Base URL is too long.".into());
    }
    let url = tauri::Url::parse(base).map_err(|_| "Invalid base URL.")?;
    if !matches!(url.scheme(), "http" | "https" | "ws" | "wss") || url.host_str().is_none() {
        return Err("Base URL must use http(s):// or ws(s):// and include a host.".into());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Base URL must not contain credentials, a query, or a fragment.".into());
    }
    Ok(url.to_string().trim_end_matches('/').into())
}

pub fn is_loopback_url(value: &str) -> bool {
    let Ok(url) = tauri::Url::parse(value) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}
