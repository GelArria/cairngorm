use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

pub const MAX_BODY: usize = 2_000_000;

/// Only accepts authenticated, length-delimited requests from our Node observer.
pub fn read_request(stream: &mut TcpStream) -> Result<(String, Vec<u8>), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);
    let mut total = 0;
    let mut line = String::new();
    bounded_line(&mut reader, &mut line, &mut total)?;
    if line.trim_end() != "POST /frame HTTP/1.1" {
        return Err("invalid request".into());
    }
    let mut token = None;
    let mut length = None;
    loop {
        line.clear();
        bounded_line(&mut reader, &mut line, &mut total)?;
        if line == "\r\n" {
            break;
        }
        let (key, value) = line.split_once(':').ok_or("invalid header")?;
        if key.eq_ignore_ascii_case("origin") || key.eq_ignore_ascii_case("transfer-encoding") {
            return Err("unsupported request".into());
        }
        if key.eq_ignore_ascii_case("authorization") {
            token = Some(
                value
                    .trim()
                    .strip_prefix("Bearer ")
                    .ok_or("invalid authorization")?
                    .to_string(),
            );
        }
        if key.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err("duplicate content length".into());
            }
            length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| "invalid length")?,
            );
        }
    }
    let length = length
        .filter(|n| *n > 0 && *n <= MAX_BODY)
        .ok_or("invalid body length")?;
    let token = token.ok_or("missing authorization")?;
    let mut body = vec![0; length];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    Ok((token, body))
}

fn bounded_line(
    reader: &mut impl BufRead,
    line: &mut String,
    total: &mut usize,
) -> Result<(), String> {
    let size = reader
        .take(8193)
        .read_line(line)
        .map_err(|e| e.to_string())?;
    *total += size;
    if size == 0 || *total > 8192 || !line.ends_with('\n') {
        return Err("invalid headers".into());
    }
    Ok(())
}

pub fn respond(stream: &mut TcpStream, accepted: bool) {
    let status = if accepted {
        "204 No Content"
    } else {
        "400 Bad Request"
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
}
