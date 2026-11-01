//! Acknowledged tldraw snapshots are scoped to their source terminal and explicit canvas.
use super::calls::{self, Call};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

const MAX_CHECKPOINT: usize = 16 * 1024 * 1024;
const MAX_MEMORY: usize = 128 * 1024 * 1024;
const BOOTSTRAP: &str = "window.__TLDRAW_BOOTSTRAP__=JSON.parse(atob(\"";
type Key = (String, String);

#[derive(Default)]
struct Memory {
    snapshots: HashMap<Key, (Value, usize)>,
    bytes: usize,
}
fn memory() -> &'static Mutex<Memory> {
    static MEMORY: OnceLock<Mutex<Memory>> = OnceLock::new();
    MEMORY.get_or_init(Default::default)
}

pub fn bind(call: &Call, value: &Value) -> Result<(), String> {
    if call.plugin != "tldraw" {
        return Ok(());
    }
    let Some(id) = value["canvasId"].as_str().filter(|id| !id.is_empty()) else {
        return Ok(());
    };
    let mut canvas = call.canvas.lock().map_err(|e| e.to_string())?;
    if canvas.as_deref().is_some_and(|existing| existing != id) {
        return Err("The tldraw response belongs to a different canvas.".into());
    }
    *canvas = Some(id.into());
    Ok(())
}

pub struct Checkpoint {
    key: Key,
    snapshot: Value,
    bytes: usize,
}

pub fn checkpoint(call: &Call, args: &Value) -> Result<Option<Checkpoint>, String> {
    let attached = call.canvas.lock().map_err(|e| e.to_string())?.clone();
    let requested = args["canvasId"].as_str().filter(|id| !id.is_empty());
    if requested
        .zip(attached.as_deref())
        .is_some_and(|(a, b)| a != b)
    {
        return Err("This view cannot save another canvas.".into());
    }
    let Some(canvas) = requested.or(attached.as_deref()) else {
        return Ok(None);
    };
    let terminal = call
        .terminal
        .as_deref()
        .ok_or("A canvas requires a source terminal.")?;
    let id = args["checkpointId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("Missing checkpoint ID.")?;
    if id.len() > 1024 || canvas.len() > 1024 {
        return Err("Canvas/checkpoint identifiers are too long.".into());
    }
    let mut bytes = id.len() + canvas.len();
    let mut array = |field: &str, required: bool| -> Result<Value, String> {
        let text = match args.get(field) {
            Some(Value::String(text)) => text.as_str(),
            None if !required => "[]",
            _ => return Err(format!("Invalid {field} checkpoint payload.")),
        };
        bytes = bytes.saturating_add(text.len());
        if bytes > MAX_CHECKPOINT {
            return Err("The canvas checkpoint is too large to restore safely.".into());
        }
        let value: Value =
            serde_json::from_str(text).map_err(|_| format!("Invalid {field} checkpoint JSON."))?;
        let values = value
            .as_array()
            .ok_or("Checkpoint records must be arrays.")?;
        if !values.iter().all(|item| {
            item.is_object()
                && if field == "bindingsJson" {
                    // Upstream bindings omit record IDs, unlike shapes and assets.
                    item["type"].is_string()
                        && item["fromId"].is_string()
                        && item["toId"].is_string()
                        && item.get("props").is_none_or(Value::is_object)
                        && item.get("meta").is_none_or(Value::is_object)
                } else {
                    item["id"].is_string() && (field != "shapesJson" || item["type"].is_string())
                }
        }) {
            return Err(format!("Invalid records in {field}."));
        }
        Ok(value)
    };
    let snapshot = json!({"canvasId":canvas,"checkpointId":id,"shapes":array("shapesJson",true)?,"assets":array("assetsJson",false)?,"bindings":array("bindingsJson",false)?});
    Ok(Some(Checkpoint {
        key: (terminal.into(), canvas.into()),
        snapshot,
        bytes,
    }))
}

/// Called only after a successful server acknowledgement, never after exec completion alone.
pub fn acknowledge(call: &Call, checkpoint: Checkpoint) -> Result<(), String> {
    bind(call, &checkpoint.snapshot)?;
    let mut memory = memory().lock().map_err(|e| e.to_string())?;
    if call.revoked.load(std::sync::atomic::Ordering::Acquire) {
        return Err("The source terminal has closed.".into());
    }
    let old = memory
        .snapshots
        .get(&checkpoint.key)
        .map_or(0, |(_, bytes)| *bytes);
    let bytes = memory
        .bytes
        .saturating_sub(old)
        .saturating_add(checkpoint.bytes);
    if bytes > MAX_MEMORY {
        return Err(
            "Canvas recovery memory is full. Close an unused source terminal and retry saving."
                .into(),
        );
    }
    memory.bytes = bytes;
    memory
        .snapshots
        .insert(checkpoint.key, (checkpoint.snapshot, checkpoint.bytes));
    Ok(())
}

fn key(call: &Call) -> Option<Key> {
    Some((call.terminal.clone()?, call.canvas.lock().ok()?.clone()?))
}
pub fn snapshot(call: &Call) -> Option<Value> {
    let key = key(call)?;
    memory()
        .lock()
        .ok()?
        .snapshots
        .get(&key)
        .map(|(snapshot, _)| snapshot.clone())
}
pub fn empty_without_checkpoint(call: &Call) -> bool {
    call.plugin == "tldraw"
        && calls::has_empty_context(call)
        && key(call).is_none_or(|key| {
            !memory()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .snapshots
                .contains_key(&key)
        })
}
pub fn ensure_reloadable(call: &Call) -> Result<(), String> {
    if call.plugin == "tldraw" && snapshot(call).is_none() && !empty_without_checkpoint(call) {
        return Err("No acknowledged canvas checkpoint is available. Keep this view open and retry after saving.".into());
    }
    Ok(())
}

pub fn restore_html(call: &Call, html: &str) -> Result<String, String> {
    if call.plugin != "tldraw" {
        return Ok(html.into());
    }
    let Some(snapshot) = snapshot(call) else {
        return Ok(html.into());
    };
    let encoded = html
        .rsplit_once(BOOTSTRAP)
        .and_then(|(_, rest)| rest.split_once('\"').map(|(data, _)| data))
        .ok_or("The deployed tldraw bootstrap contract changed; recovery is unavailable.")?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid tldraw bootstrap encoding.")?;
    let bootstrap: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid tldraw bootstrap JSON.")?;
    if !bootstrap["canvasId"].is_string() {
        return Err("The refreshed tldraw resource has no canvasId. Recovery is blocked; the current view has been kept.".into());
    }
    if !bootstrap["sessionId"].is_string() || bootstrap["canvasId"] != snapshot["canvasId"] {
        return Err("The refreshed tldraw resource belongs to another canvas; the current view has been kept.".into());
    }
    let data = STANDARD.encode(serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?);
    let shim = include_str!("../assets/tldraw-restore.js");
    Ok(format!(
        "{html}<script data-cairngorm-canvas=\"{data}\">{shim}</script>"
    ))
}

pub fn release_terminal(terminal: &str) {
    let mut memory = memory().lock().unwrap_or_else(|e| e.into_inner());
    memory.snapshots.retain(|(source, _), _| source != terminal);
    memory.bytes = memory.snapshots.values().map(|(_, bytes)| bytes).sum();
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_canvas.rs"]
mod tests;
