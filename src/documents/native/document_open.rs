//! Agent-initiated opening: the MCP file tool hands an authorized snapshot to the main window,
//! which opens it in the source terminal's project and acknowledges.
use super::{
    requests::Requests,
    tickets::{Ack, OpenRequest, Tickets, ACK_TIMEOUT},
};
use serde_json::{json, Value};
use std::{
    sync::{LazyLock, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, WebviewWindow};

pub(super) static APP: OnceLock<AppHandle> = OnceLock::new();
static TICKETS: LazyLock<Tickets> = LazyLock::new(Tickets::default);
static REQUESTS: LazyLock<Requests> = LazyLock::new(Requests::default);
/// The UI gets a deadline well inside this, so a late result can never land after the agent
/// was told the request failed (it skips saving once the deadline passes).
const OPERATION_TIMEOUT: Duration = Duration::from_secs(180);
const UI_BUDGET: Duration = Duration::from_secs(150);

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Blocks the calling gateway worker until the UI opened the document or refused it.
pub fn request_open(
    project: &str,
    terminal: &str,
    path: &str,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    let app = APP.get().ok_or("Cairngorm is still starting.")?;
    let request = OpenRequest {
        project: project.to_string(),
        terminal: terminal.to_string(),
        path: display_path(path),
        bytes,
    };
    let (opened, view, details) = TICKETS.open(
        request,
        |announcement| {
            crate::emit_safe::emit_to_main(app, "document-open-request", announcement.clone())
        },
        ACK_TIMEOUT,
    )?;
    Ok(json!({
        "path": opened.path,
        "sha256": opened.sha256,
        "size": opened.size,
        "openedIn": view,
        "operations": details["operations"].clone(),
    }))
}

/// Runs a provider-declared operation on the document open at `path` in the caller's project.
pub fn request_operation(
    project: &str,
    terminal: &str,
    path: &str,
    operation: &str,
    arguments: &Value,
    save: bool,
) -> Result<Value, String> {
    let app = APP.get().ok_or("Cairngorm is still starting.")?;
    REQUESTS.run(
        |id| {
            let request = json!({
                "id": id,
                "project": project,
                "terminal": terminal,
                "path": display_path(path),
                "operation": operation,
                "arguments": arguments,
                "save": save,
                "deadline": deadline_ms(),
            });
            crate::emit_safe::emit_to_main(app, "document-operation-request", request)
                .map_err(|e| e.to_string())
        },
        OPERATION_TIMEOUT,
    )
}

fn deadline_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|now| (now + UI_BUDGET).as_millis())
        .unwrap_or_default()
}

/// The authorized path as the app shows it: a verbatim disk path (`\\?\C:\…`) becomes `C:\…`.
pub fn display_path(path: &str) -> String {
    if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{share}");
    }
    match path.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_main_and_document_windows_may_save_or_read_snapshots() {
        for label in ["main", "detached-doc-7"] {
            assert!(super::is_document_window(label), "{label}");
        }
        for label in ["detached-12", "preview-1", "plugin", "", "Main"] {
            assert!(!super::is_document_window(label), "{label}");
        }
    }

    #[test]
    fn verbatim_disk_paths_are_shown_as_normal_paths() {
        assert_eq!(
            super::display_path(r"\\?\C:\Project B\Review.docx"),
            r"C:\Project B\Review.docx"
        );
        assert_eq!(super::display_path(r"C:\a.docx"), r"C:\a.docx");
        assert_eq!(
            super::display_path(r"\\?\UNC\server\share\a"),
            r"\\server\share\a"
        );
    }
}

fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can open agent documents.".into());
    }
    Ok(())
}

fn is_document_window(label: &str) -> bool {
    label == "main" || label.starts_with(DOCUMENT_WINDOW_PREFIX)
}

/// Label prefix of windows showing one document moved out of the main window.
pub const DOCUMENT_WINDOW_PREFIX: &str = "detached-doc-";

/// The main window, or a document window: never a provider frame, plugin view or terminal window.
pub fn require_document_window(window: &WebviewWindow) -> Result<(), String> {
    if !is_document_window(window.label()) {
        return Err("Only Cairngorm document windows can do this.".into());
    }
    Ok(())
}

/// The ticket's immutable bytes; missing once evicted, when panes fall back to the file.
#[tauri::command]
pub fn document_ticket_read(
    window: WebviewWindow,
    ticket: String,
) -> Result<tauri::ipc::Response, String> {
    require_document_window(&window)?;
    let bytes = TICKETS
        .read(&ticket)
        .ok_or("This agent snapshot is no longer available.")?;
    Ok(tauri::ipc::Response::new(bytes.as_ref().clone()))
}

#[tauri::command]
pub fn document_ticket_ack(
    window: WebviewWindow,
    ticket: String,
    opened_in: Option<String>,
    operations: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    require_main(&window)?;
    let ack = match (opened_in, error) {
        (Some(view), None) if view == "document" || view == "editor" => Ack::Opened(
            view,
            json!({ "operations": operations.unwrap_or_else(|| json!([])) }),
        ),
        (_, Some(error)) => Ack::Failed(error.chars().take(300).collect()),
        _ => return Err("Invalid acknowledgement.".into()),
    };
    TICKETS.acknowledge(&ticket, ack);
    Ok(())
}

#[tauri::command]
pub fn document_request_complete(
    window: WebviewWindow,
    id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    // A document window answers operations main forwarded to it; ids are unguessable.
    require_document_window(&window)?;
    let outcome = match error {
        Some(error) => Err(error.chars().take(500).collect()),
        None => Ok(result.unwrap_or(Value::Null)),
    };
    REQUESTS.complete(&id, outcome);
    Ok(())
}
