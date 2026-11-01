//! Hides credentials in MCP server command lines and URLs before they leave Rust, so a
//! key passed as an argument never reaches the webview or a screenshot.
const MASK: &str = "••••";
const SENSITIVE: &[&str] = &[
    "key",
    "token",
    "secret",
    "password",
    "passwd",
    "auth",
    "bearer",
    "credential",
];
/// Well-known token prefixes, masked wherever they appear on their own.
const PREFIXES: &[&str] = &[
    "sk-",
    "sk_",
    "ghp_",
    "gho_",
    "ghs_",
    "github_pat_",
    "xox",
    "ctx7sk-",
    "AKIA",
    "glpat-",
];

fn sensitive(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    SENSITIVE.iter().any(|word| lower.contains(word))
}

fn looks_like_token(word: &str) -> bool {
    PREFIXES
        .iter()
        .any(|p| word.starts_with(p) && word.len() > p.len() + 6)
}

/// Random-looking path segment: long, mixing letters and digits (an embedded key).
fn looks_random(segment: &str) -> bool {
    segment.len() >= 20
        && segment.chars().any(|c| c.is_ascii_digit())
        && segment.chars().any(|c| c.is_ascii_alphabetic())
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Mask the value of `--api-key value`, `--token=value`, `API_KEY=value`,
/// `Authorization: Bearer value`, `X-API-Key: value`, secrets inside URLs and bare tokens
/// with a known prefix. Arguments are split into words first, so a whole command line
/// in one string or a header passed as one argument is covered too.
pub fn redact_args(parts: &[String]) -> Vec<String> {
    let words = parts.iter().flat_map(|p| p.split_whitespace());
    let mut out = Vec::new();
    let mut hide_next = false;
    for part in words {
        if hide_next {
            // "Authorization: Bearer x": keep the scheme word and hide what follows it.
            if part.eq_ignore_ascii_case("bearer") || part.eq_ignore_ascii_case("basic") {
                out.push(part.to_string());
                continue;
            }
            out.push(MASK.to_string());
            hide_next = false;
            continue;
        }
        if part.starts_with("http://") || part.starts_with("https://") {
            out.push(redact_url(part));
            continue;
        }
        if let Some((name, _)) = part.split_once('=') {
            if sensitive(name) {
                out.push(format!("{name}={MASK}"));
                continue;
            }
        }
        let header_name = part.strip_suffix(':').is_some_and(sensitive);
        if (part.starts_with('-') && sensitive(part)) || header_name {
            hide_next = true;
        } else if part.eq_ignore_ascii_case("bearer") || part.eq_ignore_ascii_case("basic") {
            hide_next = true;
        } else if looks_like_token(part) {
            out.push(MASK.to_string());
            continue;
        }
        out.push(part.to_string());
    }
    out
}

/// Mask `user:password@`, random-looking path segments and sensitive query parameters.
pub fn redact_url(url: &str) -> String {
    let (base, query) = url.split_once('?').unwrap_or((url, ""));
    let base = match base.split_once("://") {
        Some((scheme, rest)) => {
            let rest = match rest.split_once('@') {
                Some((auth, host)) if !auth.contains('/') => format!("{MASK}@{host}"),
                _ => rest.to_string(),
            };
            let path: Vec<String> = rest
                .split('/')
                .enumerate()
                .map(|(i, seg)| {
                    if i > 0 && (looks_random(seg) || looks_like_token(seg)) {
                        MASK.to_string()
                    } else {
                        seg.to_string()
                    }
                })
                .collect();
            format!("{scheme}://{}", path.join("/"))
        }
        None => base.to_string(),
    };
    if query.is_empty() {
        return base;
    }
    let params: Vec<String> = query
        .split('&')
        .map(|pair| match pair.split_once('=') {
            Some((name, value)) if sensitive(name) || looks_like_token(value) => {
                format!("{name}={MASK}")
            }
            _ => pair.to_string(),
        })
        .collect();
    format!("{base}?{}", params.join("&"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> String {
        let parts: Vec<String> = line.split(' ').map(String::from).collect();
        redact_args(&parts).join(" ")
    }

    #[test]
    fn masks_secrets_in_arguments() {
        assert_eq!(
            args("npx -y @upstash/context7-mcp --api-key ctx7sk-1234567890"),
            "npx -y @upstash/context7-mcp --api-key ••••"
        );
        assert_eq!(
            args("tool --token=abc API_KEY=xyz --port 3"),
            "tool --token=•••• API_KEY=•••• --port 3"
        );
        assert_eq!(args("curl -H Bearer abcdef"), "curl -H Bearer ••••");
        assert_eq!(args("run ghp_abcdefghijklmnop"), "run ••••");
        assert_eq!(args("paper mcp"), "paper mcp");
        let header = vec![
            "mcp-remote".to_string(),
            "https://h/mcp?team=a&token=xyz".to_string(),
            "--header".to_string(),
            "Authorization: Bearer abc123".to_string(),
            "X-API-Key: k1".to_string(),
        ];
        assert_eq!(
            redact_args(&header).join(" "),
            "mcp-remote https://h/mcp?team=a&token=•••• --header Authorization: Bearer •••• X-API-Key: ••••"
        );
        let one_string = vec!["server --api-key secret1".to_string()];
        assert_eq!(redact_args(&one_string).join(" "), "server --api-key ••••");
    }

    #[test]
    fn masks_secrets_in_urls() {
        assert_eq!(
            redact_url("https://mcp.firecrawl.dev/v2/mcp"),
            "https://mcp.firecrawl.dev/v2/mcp"
        );
        assert_eq!(
            redact_url("https://x.dev/mcp?apiKey=123&team=a"),
            "https://x.dev/mcp?apiKey=••••&team=a"
        );
        assert_eq!(
            redact_url("https://user:pw@host/mcp"),
            "https://••••@host/mcp"
        );
        assert_eq!(
            redact_url("https://mcp.zapier.com/api/mcp/s/a8Kd93jfL2mQp0Zx7wYt/mcp"),
            "https://mcp.zapier.com/api/mcp/s/••••/mcp"
        );
    }
}
