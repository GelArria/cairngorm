//! Built-in, read-only tools. Never called from the embedded-view request dispatcher.
use super::{
    file_runtime::{self, Scope},
    file_scope::FileError,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub(super) const READ: &str = "cairngorm_read_file";
pub(super) const LIST: &str = "cairngorm_list_files";
pub(super) const OPEN: &str = "cairngorm_open_file";
pub(super) const OPERATE: &str = "cairngorm_document_operation";
pub(super) const CREATE: &str = "cairngorm_create_file";
pub(super) const GUIDANCE: &str = "Cairngorm file access: list directories, read UTF-8 text, create documents (such as .xlsx) and open files for the user in a Cairngorm pane beside this terminal. The first use may ask the user to allow file access. External paths need explicit per-file or session-folder approval. Opening shows a snapshot of the file as it was when opened and lists the operations its document provider offers; run them with cairngorm_document_operation. Changes are saved only by the document provider through Cairngorm, with a version check and backup. User instructions and client permissions take precedence.";

pub(super) fn tools() -> Vec<Value> {
    [(LIST, "List one authorized directory, nonrecursive, at most 1,000 entries."),
     (READ, "Read authorized UTF-8 text up to 1 MiB and return its SHA-256. Binary files are rejected."),
     (OPEN, "Open an authorized file (documents, spreadsheets, PDFs, text, up to 25 MiB) in a Cairngorm pane in this terminal's project and return its SHA-256 once the pane is shown. Formats without an installed document provider show an explicit no-provider state.")]
        .into_iter().map(|(name, description)| json!({
            "name": name, "description": format!("{description} {GUIDANCE}"),
            "inputSchema": {"type":"object", "properties":{"path":{"type":"string", "minLength":1, "maxLength":32768}}, "required":["path"], "additionalProperties":false},
            "annotations":{"readOnlyHint":true, "destructiveHint":false, "openWorldHint":false}
        })).chain(std::iter::once(json!({
            "name": CREATE,
            "description": format!("Create a new, blank document (for example report.xlsx) inside this terminal's project folder and open it in a Cairngorm pane. Missing folders are created; an existing file is never overwritten. Only formats whose document provider supplies a blank template can be created; then fill it with cairngorm_document_operation. {GUIDANCE}"),
            "inputSchema": {"type":"object", "properties":{"path":{"type":"string", "minLength":1, "maxLength":32768, "description":"Path relative to the project folder, or absolute inside it"}}, "required":["path"], "additionalProperties":false},
            "annotations":{"readOnlyHint":false, "destructiveHint":false, "idempotentHint":false, "openWorldHint":false}
        }))).chain(std::iter::once(json!({
            "name": OPERATE,
            "description": format!("Run an operation listed by cairngorm_open_file on a document open in this terminal's project. Set save to true to save afterwards: the user is asked to approve each save, and saving is refused while they have unsaved changes in that document. {GUIDANCE}"),
            "inputSchema": {"type":"object", "properties":{
                "path":{"type":"string", "minLength":1, "maxLength":32768},
                "operation":{"type":"string", "minLength":1, "maxLength":48},
                "arguments":{"type":"object"},
                "save":{"type":"boolean"}
            }, "required":["path", "operation"], "additionalProperties":false},
            "annotations":{"readOnlyHint":false, "destructiveHint":true, "openWorldHint":false}
        }))).collect()
}

pub(super) fn eligible(
    terminal: Option<&str>,
    allowed: bool,
    consented: bool,
    live: impl Fn(&str) -> bool,
) -> Option<Arc<Scope>> {
    let terminal = terminal?;
    if !allowed || !consented || !live(terminal) {
        return None;
    }
    file_runtime::runtime().lock().ok()?.scope(terminal).ok()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments {
    path: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationArguments {
    path: String,
    operation: String,
    #[serde(default)]
    arguments: serde_json::Map<String, Value>,
    #[serde(default)]
    save: bool,
}

pub(super) fn call(
    params: &Value,
    scope: Option<Arc<Scope>>,
    notify: impl Fn(Value),
) -> Result<Value, (i32, String)> {
    let name = params["name"].as_str().unwrap_or_default();
    // Every valid file tool call asks the user the first time (unless always allowed).
    let consented = |scope: Option<Arc<Scope>>| -> Result<Arc<Scope>, FileError> {
        let scope = scope.ok_or_else(|| FileError::new("not-authorized", "File access requires consent, an allowed client and a live terminal with a project folder."))?;
        super::file_consent::require(&scope, super::file_consent::FILES, "files", &notify)?;
        Ok(scope)
    };
    if name == OPERATE {
        let arguments: OperationArguments = serde_json::from_value(params["arguments"].clone())
            .map_err(|_| {
                (
                    -32602,
                    "Expected path, operation and optional arguments object and save flag."
                        .to_string(),
                )
            })?;
        if arguments.path.is_empty()
            || arguments.path.len() > 32768
            || arguments.operation.is_empty()
            || arguments.operation.len() > 48
            || Value::Object(arguments.arguments.clone()).to_string().len() > 64 * 1024
        {
            return Err((-32602, "Invalid operation request.".into()));
        }
        return Ok(result(
            consented(scope).and_then(|scope| operate(&scope, &arguments, &notify)),
        ));
    }
    let arguments: Arguments =
        serde_json::from_value(params["arguments"].clone()).map_err(|_| {
            (
                -32602,
                "Expected exactly one string argument: path.".to_string(),
            )
        })?;
    if arguments.path.is_empty() || arguments.path.len() > 32768 {
        return Err((-32602, "Invalid path length.".into()));
    }
    if name == CREATE {
        return Ok(result(consented(scope).and_then(|scope| {
            super::file_create::create(&scope, &arguments.path)
        })));
    }
    Ok(match consented(scope) {
        Err(error) => result(Err(error)),
        Ok(scope) => result(
            read(&scope, name, &arguments.path, &notify).and_then(|value| {
                let runtime = file_runtime::runtime()
                    .lock()
                    .map_err(|e| FileError::new("file-unavailable", e.to_string()))?;
                if !runtime.current(&scope)
                    || !crate::pty::session_exists(&scope.metadata.session_id)
                {
                    return Err(FileError::new(
                        "scope-revoked",
                        "The source terminal or file permission was revoked.",
                    ));
                }
                Ok(value)
            }),
        ),
    })
}

/// Checked right before anything is shown or changed: a revoked scope or closed terminal stops here.
pub(super) fn still_authorized(scope: &Arc<Scope>) -> Result<(), FileError> {
    let runtime = file_runtime::runtime()
        .lock()
        .map_err(|e| FileError::new("file-unavailable", e.to_string()))?;
    if !runtime.current(scope) || !crate::pty::session_exists(&scope.metadata.session_id) {
        return Err(FileError::new(
            "scope-revoked",
            "The source terminal or file permission was revoked.",
        ));
    }
    Ok(())
}

fn operate(
    scope: &Arc<Scope>,
    arguments: &OperationArguments,
    notify: impl FnOnce(Value),
) -> Result<Value, FileError> {
    let path = scope.root.resolve(&arguments.path)?;
    let root = if path.starts_with(scope.root.root_path()) {
        scope.root.clone()
    } else {
        super::file_permissions::request_access(scope.clone(), path.clone(), false, notify)?
    };
    let path = path
        .to_str()
        .ok_or_else(|| FileError::new("invalid-path", "The path is not Unicode."))?;
    // Authorized like a read; the operation itself runs in the open document's provider view.
    let authorized = root.open_read(path)?.path.to_string_lossy().into_owned();
    still_authorized(scope)?;
    crate::documents::request_operation(
        &scope.metadata.project_id,
        &scope.metadata.session_id,
        &authorized,
        &arguments.operation,
        &Value::Object(arguments.arguments.clone()),
        arguments.save,
    )
    .map_err(|error| FileError::new("operation-failed", error))
}

pub(super) fn read(
    scope: &Arc<Scope>,
    name: &str,
    path: &str,
    notify: impl FnOnce(Value),
) -> Result<Value, FileError> {
    let path = scope.root.resolve(path)?;
    let directory = name == LIST;
    let root = if path.starts_with(scope.root.root_path()) {
        scope.root.clone()
    } else {
        super::file_permissions::request_access(scope.clone(), path.clone(), directory, notify)?
    };
    let path = path
        .to_str()
        .ok_or_else(|| FileError::new("invalid-path", "The path is not Unicode."))?;
    if directory {
        return root.list(path);
    }
    if name == OPEN {
        let snapshot = root.open_read(path)?.snapshot(25 * 1024 * 1024)?;
        let shown = snapshot.path.to_string_lossy().into_owned();
        still_authorized(scope)?;
        return crate::documents::request_open(
            &scope.metadata.project_id,
            &scope.metadata.session_id,
            &shown,
            snapshot.bytes,
        )
        .map_err(|error| FileError::new("open-failed", error));
    }
    let snapshot = root.open_read(path)?.snapshot(1024 * 1024)?;
    let hash = format!("{:x}", Sha256::digest(&snapshot.bytes));
    let content = String::from_utf8(snapshot.bytes)
        .map_err(|_| FileError::new("binary-file", "Only UTF-8 text is supported."))?;
    if content
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\t' | '\r' | '\n'))
    {
        return Err(FileError::new(
            "binary-file",
            "Binary content cannot be read as text.",
        ));
    }
    Ok(json!({"path": snapshot.path, "content": content, "sha256": hash}))
}

pub(super) fn result(outcome: Result<Value, FileError>) -> Value {
    let (value, error) = match outcome {
        Ok(value) => (value, false),
        Err(error) => (json!({"code": error.code, "message": error.message}), true),
    };
    json!({"content":[{"type":"text", "text":value.to_string()}], "structuredContent":value, "isError":error})
}
