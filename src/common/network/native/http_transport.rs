//! Proxy and certificate policy for Cairngorm's native HTTP clients (ureq).
//!
//! ureq's own proxy detection stays off: it ignores NO_PROXY and uses one proxy for every
//! scheme. Callers build an agent for the URL they request, so the route is chosen for that
//! destination. A redirect to another host keeps the first request's route.
use rustls::pki_types::{pem::PemObject, CertificateDer};
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;
use url::{Host, Url};

/// PEM file of additional root certificates, added to the bundled roots. Node.js uses the
/// same name and child processes inherit it, so one setting can serve native requests and
/// Node-based agent CLIs alike.
const EXTRA_CA_VAR: &str = "NODE_EXTRA_CA_CERTS";

/// An agent builder for requests to `url`, using the environment's proxy for that URL
/// (unless NO_PROXY excludes it) and the bundled roots plus `NODE_EXTRA_CA_CERTS`.
/// Callers add their own timeouts, redirect and HTTPS-only policy.
pub fn agent_builder(url: &str) -> Result<ureq::AgentBuilder, String> {
    let env = |name: &str| std::env::var(name).ok();
    // Explicit: a dependency enabling ureq's `proxy-from-env` must not bypass NO_PROXY.
    let mut builder = ureq::AgentBuilder::new().try_proxy_from_env(false);
    if let Some((name, address)) = select_proxy(url, env)? {
        let proxy = ureq::Proxy::new(address).map_err(|_| invalid_proxy(name))?;
        builder = builder.proxy(proxy);
    }
    if let Some(config) = tls_config(env)? {
        builder = builder.tls_config(config);
    }
    Ok(builder)
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn invalid_proxy(name: &str) -> String {
    format!("{name} must be an http:// proxy address, such as http://proxy.example:8080.")
}

/// The proxy variable and ureq proxy address for `url`, or `None` for a direct connection.
/// Lowercase names win over uppercase; the scheme's own variable wins over ALL_PROXY.
pub(crate) fn select_proxy(
    url: &str,
    env: impl Fn(&str) -> Option<String>,
) -> Result<Option<(&'static str, String)>, String> {
    let url = Url::parse(url).map_err(|_| "The request address is not a valid URL.".to_string())?;
    let names: [&'static str; 4] = match url.scheme() {
        "http" => ["http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"],
        "https" => ["https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"],
        _ => return Ok(None),
    };
    let Some((name, value)) = names
        .into_iter()
        .find_map(|name| non_empty(env(name)).map(|value| (name, value)))
    else {
        return Ok(None);
    };
    let Some(host) = url.host() else {
        return Ok(None);
    };
    let no_proxy = non_empty(env("no_proxy")).or_else(|| non_empty(env("NO_PROXY")));
    if let Some(list) = no_proxy {
        if bypasses(&list, &host)? {
            return Ok(None);
        }
    }
    proxy_address(name, &value).map(|address| Some((name, address)))
}

/// `http://user:pass@host:port` in the form ureq parses. The values never appear in errors.
fn proxy_address(name: &'static str, value: &str) -> Result<String, String> {
    let value = if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{value}")
    };
    let proxy = Url::parse(&value).map_err(|_| invalid_proxy(name))?;
    if proxy.scheme() != "http" {
        return Err(invalid_proxy(name));
    }
    let host = match proxy.host() {
        Some(Host::Domain(domain)) => domain.to_string(),
        Some(Host::Ipv4(ip)) => ip.to_string(),
        // ureq splits the proxy address at ':' and cannot parse an IPv6 literal.
        _ => {
            return Err(format!(
                "{name}: use a host name or IPv4 address for the proxy."
            ))
        }
    };
    let port = proxy.port_or_known_default().unwrap_or(80);
    let decode = |part: &str| {
        percent_encoding::percent_decode_str(part)
            .decode_utf8()
            .map(|text| text.into_owned())
            .map_err(|_| invalid_proxy(name))
    };
    if proxy.username().is_empty() && proxy.password().is_none() {
        return Ok(format!("http://{host}:{port}"));
    }
    let user = decode(proxy.username())?;
    let password = decode(proxy.password().unwrap_or_default())?;
    if user.contains(':') {
        return Err(invalid_proxy(name));
    }
    Ok(format!("http://{user}:{password}@{host}:{port}"))
}

/// NO_PROXY entries are separated by commas or spaces. `*` matches every host; a name
/// matches itself and its subdomains (a leading `.` or `*.` is optional); an IP address or
/// CIDR range matches IP literals only. Ports in entries are ignored, so a listed host is
/// always reached directly. Names are not resolved.
fn bypasses(list: &str, host: &Host<&str>) -> Result<bool, String> {
    let ip: Option<IpAddr> = match host {
        Host::Ipv4(ip) => Some((*ip).into()),
        Host::Ipv6(ip) => Some((*ip).into()),
        Host::Domain(_) => None,
    };
    let name = match host {
        Host::Domain(domain) => domain.trim_end_matches('.').to_ascii_lowercase(),
        _ => String::new(),
    };
    let entries: Vec<&str> = list
        .split(|c: char| c == ',' || c.is_whitespace())
        .map(|entry| strip_port(entry.trim()))
        .filter(|entry| !entry.is_empty())
        .collect();
    // Validate the whole list first, so an invalid range is reported for every host.
    if let Some(entry) = entries.iter().find(|entry| {
        entry.contains('/') && range_contains(entry, IpAddr::from([0, 0, 0, 0])).is_none()
    }) {
        return Err(format!(
            "NO_PROXY entry \"{entry}\" is not a valid address range."
        ));
    }
    for entry in entries {
        if entry == "*" {
            return Ok(true);
        }
        if entry.contains('/') {
            if ip.is_some_and(|ip| range_contains(entry, ip) == Some(true)) {
                return Ok(true);
            }
            continue;
        }
        if let Some(ip) = ip {
            if entry.parse::<IpAddr>().is_ok_and(|listed| listed == ip) {
                return Ok(true);
            }
            continue;
        }
        let entry = entry.trim_start_matches("*.").trim_start_matches('.');
        let entry = entry.trim_end_matches('.').to_ascii_lowercase();
        if !entry.is_empty() && (name == entry || name.ends_with(&format!(".{entry}"))) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `host:port` → `host`, `[v6]:port` → `v6`; an unbracketed IPv6 address stays whole.
/// A bracketed range such as `[fd00::]/8` is left as is and reported as invalid.
fn strip_port(entry: &str) -> &str {
    if let Some(rest) = entry.strip_prefix('[') {
        return match rest.split_once(']') {
            Some((_, after)) if after.starts_with('/') => entry,
            Some((address, _)) => address,
            None => rest,
        };
    }
    match entry.split_once(':') {
        Some((host, port)) if !port.contains(':') => host,
        _ => entry,
    }
}

/// Whether CIDR `range` contains `ip`; `None` when `range` is not valid CIDR.
fn range_contains(range: &str, ip: IpAddr) -> Option<bool> {
    let (network, bits) = range.split_once('/')?;
    let network: IpAddr = network.parse().ok()?;
    let bits: u32 = bits.parse().ok()?;
    let (net, addr, width) = match (network, ip) {
        (IpAddr::V4(n), IpAddr::V4(a)) => (u32::from(n) as u128, u32::from(a) as u128, 32),
        (IpAddr::V6(n), IpAddr::V6(a)) => (u128::from(n), u128::from(a), 128),
        (IpAddr::V4(_), _) if bits <= 32 => return Some(false),
        (IpAddr::V6(_), _) if bits <= 128 => return Some(false),
        _ => return None,
    };
    if bits > width {
        return None;
    }
    Some(bits == 0 || (net ^ addr) >> (width - bits) == 0)
}

/// The bundled Mozilla roots plus the roots in `NODE_EXTRA_CA_CERTS`, or `None` to keep
/// ureq's default. Chain and host name verification are unchanged; a file that cannot be
/// used is an error rather than being skipped.
pub(crate) fn tls_config(
    env: impl Fn(&str) -> Option<String>,
) -> Result<Option<Arc<rustls::ClientConfig>>, String> {
    let Some(path) = non_empty(env(EXTRA_CA_VAR)) else {
        return Ok(None);
    };
    let roots = root_store(Path::new(&path))
        .map_err(|reason| format!("{EXTRA_CA_VAR} ({path}) {reason}"))?;
    // Same provider and protocol versions as ureq's default configuration.
    let config = rustls::ClientConfig::builder_with_provider(
        rustls::crypto::ring::default_provider().into(),
    )
    .with_protocol_versions(&[&rustls::version::TLS12, &rustls::version::TLS13])
    .map_err(|e| e.to_string())?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(Some(Arc::new(config)))
}

pub(crate) fn root_store(path: &Path) -> Result<rustls::RootCertStore, String> {
    let mut roots = rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    };
    let certificates =
        CertificateDer::pem_file_iter(path).map_err(|e| format!("could not be read: {e}"))?;
    let mut added = 0;
    // Only CERTIFICATE sections are read; any private key in the file is skipped.
    for certificate in certificates {
        let certificate = certificate.map_err(|e| format!("is not a valid PEM file: {e}"))?;
        roots
            .add(certificate)
            .map_err(|e| format!("holds a certificate that cannot be a root: {e}"))?;
        added += 1;
    }
    if added == 0 {
        return Err("holds no PEM certificates.".into());
    }
    Ok(roots)
}

#[cfg(test)]
#[path = "../../../../tests/native/http-transport.rs"]
mod tests;
