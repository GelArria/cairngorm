//! Serves document hosts from the plugin gateway: Cairngorm's relay frame on `d-<key>` and the
//! approved provider bundle on `v-<key>` (see `document_origins.rs`).
//! Each (provider, project) pair gets its own origin, so a provider's storage never mixes
//! projects and its code never shares the app's origin, Tauri IPC or the gateway secret.
use super::{bundle, install, manifest, origins};
use std::{fs, io::Read, path::Path};

const SDK: &str = include_str!("../sdk/generated/document-sdk.js");
pub const SDK_PATH: &str = "_cairngorm/document-sdk.js";
const GUARD_PATH: &str = "_cairngorm/guard.js";
const GUARD: &str = include_str!("../sdk/frame/guard.js");
const FRAME_HTML_PATH: &str = "_cairngorm/frame.html";
const FRAME_JS_PATH: &str = "_cairngorm/frame.js";
const FRAME_HTML: &str = include_str!("../sdk/frame/frame.html");
const FRAME_JS: &str = include_str!("../sdk/frame/frame.js");
/// Only Cairngorm's own window may embed the relay frame (the dev server in debug builds).
#[cfg(debug_assertions)]
const APP_ORIGINS: &str = "http://tauri.localhost tauri://localhost http://localhost:1420";
#[cfg(not(debug_assertions))]
const APP_ORIGINS: &str = "http://tauri.localhost tauri://localhost";
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;
/// Same-origin assets and wasm only: no remote connections, frames, forms or plugins.
const CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

pub struct Response {
    pub status: &'static str,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

/// `None` when the request is not for a document host, so the gateway handles it.
/// Without a data folder (no pane opened yet) every document host gets 404.
pub fn serve(
    root: Option<&Path>,
    gateway: &str,
    method: &str,
    path: &str,
    host: Option<&str>,
) -> Option<Response> {
    let host = host?;
    if !origins::is_document_host(host) {
        return None;
    }
    let (Some(root), Some((role, key)), "GET") = (root, origins::host_key(gateway, host), method)
    else {
        return Some(not_found());
    };
    let Some(provider) = origins::provider_for(key) else {
        return Some(not_found());
    };
    let Some(manifest) = install::approved(root, &provider) else {
        return Some(not_found());
    };
    let relative = match request_path(path) {
        Some(relative) if relative.is_empty() => manifest.entry.clone(),
        Some(relative) => relative,
        None => return Some(not_found()),
    };
    if role == origins::Host::Frame {
        return Some(frame_file(
            &relative,
            &origins::provider_origin(gateway, key),
        ));
    }
    let ancestors = origins::frame_origin(gateway, key);
    Some(only_in_frame(
        provider_file(root, &provider, &relative),
        &ancestors,
    ))
}

/// Provider files may be embedded only by their own relay frame inside Cairngorm, never by
/// another page. frame-ancestors checks every ancestor, so the app window is listed too.
fn only_in_frame(mut response: Response, frame: &str) -> Response {
    if let Some((_, csp)) = response
        .headers
        .iter_mut()
        .find(|(name, _)| *name == "Content-Security-Policy")
    {
        *csp = format!("{csp}; frame-ancestors {frame} {APP_ORIGINS}");
    }
    response
}

fn provider_file(root: &Path, provider: &str, relative: &str) -> Response {
    if relative == SDK_PATH {
        return ok("text/javascript; charset=utf-8", SDK.as_bytes().to_vec());
    }
    if relative == GUARD_PATH {
        return ok("text/javascript; charset=utf-8", GUARD.as_bytes().to_vec());
    }
    match read_bundle_file(&root.join(provider), relative) {
        Some(body) if content_type(relative).starts_with("text/html") => {
            ok(content_type(relative), with_guard(&body))
        }
        Some(body) => ok(content_type(relative), body),
        None => not_found(),
    }
}

/// The relay frame may embed only its sibling provider origin: the provider cannot navigate
/// its frame anywhere else, so document data cannot leave through a navigation.
fn frame_file(relative: &str, provider: &str) -> Response {
    let (content_type, body) = match relative {
        FRAME_HTML_PATH => ("text/html; charset=utf-8", FRAME_HTML),
        FRAME_JS_PATH => ("text/javascript; charset=utf-8", FRAME_JS),
        _ => return not_found(),
    };
    let csp = format!(
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src {provider}; frame-ancestors {}; base-uri 'none'; form-action 'none'",
        APP_ORIGINS
    );
    let mut response = ok(content_type, body.as_bytes().to_vec());
    response.headers[1].1 = csp;
    response
}

/// Puts the guard script first in the document, ahead of every provider script.
pub fn with_guard(html: &[u8]) -> Vec<u8> {
    let tag = format!(r#"<script src="/{GUARD_PATH}"></script>"#);
    let text = String::from_utf8_lossy(html);
    let lower = text.to_ascii_lowercase();
    let after = |needle: &str| {
        lower
            .find(needle)
            .and_then(|start| lower[start..].find('>').map(|end| start + end + 1))
    };
    let at = after("<head").or_else(|| after("<!doctype")).unwrap_or(0);
    format!("{}{tag}{}", &text[..at], &text[at..]).into_bytes()
}

/// Decoded, slash-separated, every segment checked; `None` refuses traversal and oddities.
pub fn request_path(path: &str) -> Option<String> {
    let path = path.split(['?', '#']).next()?.strip_prefix('/')?;
    let decoded = percent_decode(path)?;
    if decoded.is_empty() {
        return Some(decoded);
    }
    let reserved =
        [SDK_PATH, GUARD_PATH, FRAME_HTML_PATH, FRAME_JS_PATH].contains(&decoded.as_str());
    (reserved || decoded.split('/').all(manifest::valid_segment)).then_some(decoded)
}

pub(super) fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok().filter(|s| !s.contains('\0'))
}

/// Each component is checked without following links.
fn read_bundle_file(folder: &Path, relative: &str) -> Option<Vec<u8>> {
    let mut path = folder.to_path_buf();
    for segment in relative.split('/') {
        path.push(segment);
        if bundle::is_link(&fs::symlink_metadata(&path).ok()?) {
            return None;
        }
    }
    let file = fs::File::open(&path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return None;
    }
    let mut body = Vec::new();
    file.take(MAX_FILE_BYTES).read_to_end(&mut body).ok()?;
    Some(body)
}

fn content_type(path: &str) -> &'static str {
    let extension = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn ok(content_type: &str, body: Vec<u8>) -> Response {
    Response {
        status: "200 OK",
        headers: vec![
            ("Content-Type", content_type.to_string()),
            ("Content-Security-Policy", CSP.to_string()),
            ("Cache-Control", "no-cache".to_string()),
            ("Referrer-Policy", "no-referrer".to_string()),
            ("Cross-Origin-Opener-Policy", "same-origin".to_string()),
        ],
        body,
    }
}

fn not_found() -> Response {
    Response {
        status: "404 Not Found",
        headers: Vec::new(),
        body: Vec::new(),
    }
}

#[cfg(test)]
#[path = "../../../tests/native/document_serve.rs"]
mod tests;
