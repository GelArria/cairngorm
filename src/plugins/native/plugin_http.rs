//! Minimal HTTP/1.1 for the loopback gateway: one request per connection.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

const MAX_HEADERS: usize = 16 * 1024;
pub const MAX_BODY: usize = 4 * 1024 * 1024;
/// The whole request, not each read: a trickling client cannot hold a worker.
const READ_DEADLINE: Duration = Duration::from_secs(10);

pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// Reading is bounded in time and size; writing may take as long as the tool call.
pub fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    let deadline = Instant::now() + READ_DEADLINE;
    let mut reader = BufReader::new(stream);
    let mut total = 0;
    let mut line = String::new();
    remaining(&mut reader, deadline)?;
    bounded_line(&mut reader, &mut line, &mut total)?;
    let mut parts = line.trim_end().split(' ');
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    if parts.next() != Some("HTTP/1.1") || !matches!(method.as_str(), "GET" | "POST") {
        return Err("invalid request line".into());
    }
    let mut headers = Vec::new();
    let mut length = 0;
    loop {
        line.clear();
        remaining(&mut reader, deadline)?;
        bounded_line(&mut reader, &mut line, &mut total)?;
        if line == "\r\n" {
            break;
        }
        let (key, value) = line.split_once(':').ok_or("invalid header")?;
        let (key, value) = (key.trim().to_string(), value.trim().to_string());
        if key.eq_ignore_ascii_case("transfer-encoding") {
            return Err("chunked bodies are not supported".into());
        }
        if key.eq_ignore_ascii_case("content-length") {
            length = value.parse::<usize>().map_err(|_| "invalid length")?;
        }
        headers.push((key, value));
    }
    if length > MAX_BODY {
        return Err("body too large".into());
    }
    remaining(&mut reader, deadline)?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok(Request {
        method,
        path,
        headers,
        body,
    })
}

fn remaining(reader: &mut BufReader<&mut TcpStream>, deadline: Instant) -> Result<(), String> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err("request took too long".into());
    }
    reader
        .get_ref()
        .set_read_timeout(Some(left))
        .map_err(|e| e.to_string())
}

fn bounded_line(
    reader: &mut impl BufRead,
    line: &mut String,
    total: &mut usize,
) -> Result<(), String> {
    let size = reader
        .take((MAX_HEADERS + 1) as u64)
        .read_line(line)
        .map_err(|e| e.to_string())?;
    *total += size;
    if size == 0 || *total > MAX_HEADERS || !line.ends_with('\n') {
        return Err("invalid headers".into());
    }
    Ok(())
}

pub fn respond(stream: &mut TcpStream, status: &str, headers: &[(&str, String)], body: &[u8]) {
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n",
        body.len()
    );
    for (key, value) in headers {
        // Values are built by the gateway; refuse anything that could split headers.
        if value.contains(['\r', '\n']) {
            continue;
        }
        head.push_str(&format!("{key}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}
