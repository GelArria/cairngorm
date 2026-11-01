//! `cairngorm.json`: one user-editable settings file (JSON with comments) in Cairngorm's data
//! folder. Detection (shells, CLIs, applications) keeps working; the file adds, hides or
//! changes what was detected. Permissions are never read from it: they are granted only in
//! Cairngorm's dialogs. Edits made in any editor apply live.
use serde::Serialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager};

const FILE: &str = "cairngorm.json";
const SCHEMA_FILE: &str = "cairngorm.schema.json";
const SCHEMA: &str = include_str!("../cairngorm.schema.json");
const MAX_BYTES: usize = 1024 * 1024;

static PATH: OnceLock<PathBuf> = OnceLock::new();
/// Last parsed contents and the modification time they came from.
static CACHE: Mutex<Option<(Option<SystemTime>, Value)>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    pub path: String,
    /// `None` until the file exists (the frontend then creates it from older settings).
    pub text: Option<String>,
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = PATH.get() {
        return Ok(path.clone());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(PATH.get_or_init(|| dir.join(FILE)).clone())
}

/// Comments and trailing commas removed, so `serde_json` reads what editors accept.
/// `None` when a block comment is never closed (editors report that as an error too).
pub fn strip_jsonc(text: &str) -> Option<String> {
    let text = text.strip_prefix('﻿').unwrap_or(text);
    let mut closed = true;
    let stripped = without_comments(text, &mut closed);
    closed.then(|| without_trailing_commas(&stripped))
}

type Chars<'a> = std::iter::Peekable<std::str::Chars<'a>>;

/// Calls `visit` for every character outside strings; string contents are copied unchanged.
fn scan(text: &str, mut visit: impl FnMut(char, &mut Chars, &mut String)) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if c == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
            out.push(c);
        } else {
            visit(c, &mut chars, &mut out);
        }
    }
    out
}

fn without_comments(text: &str, closed: &mut bool) -> String {
    scan(text, |c, chars, out| match (c, chars.peek()) {
        ('/', Some('/')) => {
            for next in chars.by_ref() {
                if next == '\n' {
                    out.push('\n');
                    break;
                }
            }
        }
        ('/', Some('*')) => {
            chars.next();
            let mut last = ' ';
            let mut ended = false;
            for next in chars.by_ref() {
                if last == '*' && next == '/' {
                    ended = true;
                    break;
                }
                last = next;
            }
            *closed &= ended;
            // A comment separates tokens: `tru/**/e` must not become `true`.
            out.push(' ');
        }
        _ => out.push(c),
    })
}

fn without_trailing_commas(text: &str) -> String {
    scan(text, |c, chars, out| {
        if c == ',' {
            let next = chars.clone().find(|n| !n.is_whitespace());
            let previous = out.chars().rev().find(|c| !c.is_whitespace());
            // Only a comma after a value can trail; `{,}` and `[,]` remain invalid.
            if matches!(next, Some('}') | Some(']'))
                && previous.is_some_and(|c| !matches!(c, '{' | '[' | ',' | ':'))
            {
                return;
            }
        }
        out.push(c);
    })
}

pub fn parse(text: &str) -> Result<Value, String> {
    let stripped =
        strip_jsonc(text).ok_or_else(|| format!("{FILE} has a comment that is never closed."))?;
    let value: Value =
        serde_json::from_str(&stripped).map_err(|e| format!("{FILE} is not valid JSON: {e}"))?;
    if !value.is_object() {
        return Err(format!("{FILE} must contain a JSON object."));
    }
    Ok(value)
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// The parsed file (an empty object when missing or invalid), re-read when it changed.
pub fn current() -> Value {
    let Some(path) = PATH.get() else {
        return Value::Object(Default::default());
    };
    let stamp = modified(path);
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((cached, value)) = cache.as_ref() {
        if *cached == stamp {
            return value.clone();
        }
    }
    let value = std::fs::read_to_string(path)
        .ok()
        .filter(|text| text.len() <= MAX_BYTES)
        .and_then(|text| parse(&text).ok())
        .unwrap_or_else(|| Value::Object(Default::default()));
    *cache = Some((stamp, value.clone()));
    value
}

/// One top-level section, e.g. `section("applications")`.
pub fn section(name: &str) -> Value {
    current().get(name).cloned().unwrap_or(Value::Null)
}

#[tauri::command]
pub async fn config_read(app: AppHandle) -> Result<ConfigFile, String> {
    let path = path(&app)?;
    crate::blocking(move || {
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => Some(text),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        Ok(ConfigFile {
            path: path.to_string_lossy().into_owned(),
            text,
        })
    })
    .await?
}

/// Saves the whole file (the frontend edits it keeping comments). Invalid JSON is refused.
#[tauri::command]
pub async fn config_write(app: AppHandle, text: String) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err(format!("{FILE} is larger than 1 MiB."));
    }
    parse(&text)?;
    let path = path(&app)?;
    crate::blocking(move || {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        // One writer at a time (windows save independently); each write has its own
        // temporary file, so a concurrent save can never rename half of another one.
        static WRITING: Mutex<()> = Mutex::new(());
        let _turn = WRITING.lock().unwrap_or_else(|e| e.into_inner());
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
        let written = std::fs::write(&temporary, &text)
            .and_then(|()| std::fs::rename(&temporary, &path))
            .map_err(|e| e.to_string());
        if written.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        written
    })
    .await?
}

/// Startup: writes the schema next to the file (editor autocompletion) and announces every
/// change to all windows, including edits made outside Cairngorm.
pub fn init(app: &AppHandle) {
    let Ok(path) = path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
        let schema = dir.join(SCHEMA_FILE);
        if std::fs::read_to_string(&schema).ok().as_deref() != Some(SCHEMA) {
            let _ = std::fs::write(schema, SCHEMA);
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = modified(&path);
        loop {
            std::thread::sleep(Duration::from_millis(800));
            let now = modified(&path);
            if now != last {
                last = now;
                crate::emit_safe::emit_bg(&app, "config-changed", ());
            }
        }
    });
}

#[cfg(test)]
#[path = "../../../tests/native/config.rs"]
mod tests;
