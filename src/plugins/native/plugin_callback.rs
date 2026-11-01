//! The loopback redirect of a browser sign-in. Each connection is read on its own short-
//! lived thread, so an idle or slow client never delays the real redirect or a cancel.
//! Only a request carrying this sign-in's `state` is answered with anything but a refusal.
use super::http;
use std::{
    collections::HashMap,
    io::ErrorKind,
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

/// Long enough to create an account on the way; short enough not to strand a listener.
const WAIT: Duration = Duration::from_secs(5 * 60);
/// Connections being read at once; more are dropped (a browser needs one).
const MAX_READERS: usize = 8;

pub const CANCELLED: &str = "Sign-in was cancelled.";

/// The browser tab that delivered the code, answered once the sign-in is known to work.
pub struct Redirect {
    pub code: String,
    stream: TcpStream,
}

impl Redirect {
    pub fn finish(mut self, message: &str) {
        page(&mut self.stream, "200 OK", message);
    }
}

pub fn listen() -> Result<(TcpListener, String), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    Ok((listener, format!("http://127.0.0.1:{port}/callback")))
}

pub fn wait(
    listener: &TcpListener,
    state: &str,
    name: &str,
    cancelled: &AtomicBool,
) -> Result<Redirect, String> {
    let deadline = Instant::now() + WAIT;
    let (sender, requests) = mpsc::channel::<(http::Request, TcpStream)>();
    let readers = Arc::new(AtomicUsize::new(0));
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        if Instant::now() > deadline {
            return Err(format!("Signing in to {name} took too long. Try again."));
        }
        while let Ok((request, mut stream)) = requests.try_recv() {
            let Some(query) = request.path.strip_prefix("/callback?") else {
                http::respond(&mut stream, "404 Not Found", &[], b"");
                continue;
            };
            let params = parse_query(query);
            // Anything else reaching this port (a stale tab, another page) is turned away.
            if params.get("state").map(String::as_str) != Some(state) {
                page(
                    &mut stream,
                    "400 Bad Request",
                    "This sign-in link has expired. Start again from Cairngorm.",
                );
                continue;
            }
            if let Some(error) = params.get("error") {
                let reason = params.get("error_description").unwrap_or(error);
                let message = format!("{name} did not sign you in: {reason}");
                page(&mut stream, "200 OK", &message);
                return Err(message);
            }
            match params.get("code") {
                Some(code) => {
                    return Ok(Redirect {
                        code: code.clone(),
                        stream,
                    })
                }
                None => page(
                    &mut stream,
                    "400 Bad Request",
                    "The sign-in answer was incomplete.",
                ),
            }
        }
        match listener.accept() {
            Ok((stream, _)) if readers.load(Ordering::SeqCst) < MAX_READERS => {
                readers.fetch_add(1, Ordering::SeqCst);
                let (sender, readers) = (sender.clone(), readers.clone());
                std::thread::spawn(move || {
                    let mut stream = stream;
                    // Accepted sockets inherit non-blocking mode on some platforms.
                    let _ = stream.set_nonblocking(false);
                    if let Ok(request) = http::read_request(&mut stream) {
                        // The sign-in may have ended; then the tab simply gets no answer.
                        let _ = sender.send((request, stream));
                    }
                    readers.fetch_sub(1, Ordering::SeqCst);
                });
            }
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn page(stream: &mut TcpStream, status: &str, message: &str) {
    let text = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Cairngorm</title>\
         <body style=\"font:15px system-ui;margin:20vh auto;max-width:36em;text-align:center\">\
         <p>{text}</p>"
    );
    let headers = [
        ("Content-Type", "text/html; charset=utf-8".to_string()),
        (
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'".to_string(),
        ),
        ("Cache-Control", "no-store".to_string()),
    ];
    http::respond(stream, status, &headers, body.as_bytes());
}

/// `a=1&b=x%20y` with `+` as a space, as browsers send form-encoded queries.
pub fn parse_query(query: &str) -> HashMap<String, String> {
    let decode = |text: &str| {
        let bytes = text.replace('+', " ").into_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|h| std::str::from_utf8(h).ok());
            match (bytes[i], hex.and_then(|h| u8::from_str_radix(h, 16).ok())) {
                (b'%', Some(byte)) => {
                    out.push(byte);
                    i += 3;
                }
                (byte, _) => {
                    out.push(byte);
                    i += 1;
                }
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    };
    query
        .split('&')
        .filter_map(|pair| pair.split_once('=').or(Some((pair, ""))))
        .map(|(k, v)| (decode(k), decode(v)))
        .collect()
}
