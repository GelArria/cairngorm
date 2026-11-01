//! MCP tools for driving installed applications through their own automation API:
//! `cairngorm_list_apps` finds them, `cairngorm_app_script` runs a script in a COM one
//! (`app_mcp_tools` covers applications with their own MCP server). Each application asks
//! the user the first time a terminal uses it, and its window is shown beside the terminal.
use super::{
    app_discovery::{self, App},
    app_script,
    file_runtime::Scope,
    file_scope::FileError,
    files::result,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub(super) const LIST: &str = "cairngorm_list_apps";
pub(super) const RUN: &str = "cairngorm_app_script";
pub(super) const GUIDANCE: &str = "Installed applications are driven through their own automation API; cairngorm_list_apps lists them with their driver. Driver \"com\" (Windows: Excel, Word, PowerPoint, Outlook and any other registered app): use cairngorm_app_script with a Windows PowerShell script where $app is the application's COM object (the running instance, or a new one; $started tells which). Use the application's official object model (for example $app.Workbooks.Open(path), $ws.Shapes.AddChart2(...)), save explicitly, and write results with Write-Output. Set $app.Visible = $true to let the user watch. Driver \"osa\" (macOS: any application with a scripting dictionary): use cairngorm_app_script with JavaScript for Automation where app is the application (Application(bundle id)), started tells whether it was not running, and print(...) writes output; use the application's own dictionary (for example app.documents[0].save()). Driver \"mcp\" (applications with their own MCP server, such as the Craft apps): list its tools with cairngorm_app_tools, then run them with cairngorm_app_call. Each application asks the user once. Requests run up to timeoutSeconds (default 120, at most 240). A request that cannot finish stops early with a reason in \"stopped\": app-dialog (the application waits for an answer in a dialog; its text is in \"message\"; tell the user, never assume it was dismissed), app-busy (an earlier request is still running in it), timed-out or cancelled. Office PDF export may require an installed printer such as Microsoft Print to PDF; never install or enable one without the user's permission.";

pub(super) fn tools() -> Vec<Value> {
    vec![
        json!({
            "name": LIST,
            "description": format!("List installed applications agents can script. {GUIDANCE}"),
            "inputSchema": {"type":"object", "properties":{"refresh":{"type":"boolean"}}, "additionalProperties":false},
            "annotations":{"readOnlyHint":true, "destructiveHint":false, "openWorldHint":false}
        }),
        json!({
            "name": RUN,
            "description": format!("Run a script inside an installed application (id from cairngorm_list_apps). Runs in this terminal's project folder with the user's permissions; returns stdout, stderr, the exit code and, when it was stopped early, why. {GUIDANCE}"),
            "inputSchema": {"type":"object", "properties":{
                "app":{"type":"string", "minLength":1, "maxLength":64},
                "script":{"type":"string", "minLength":1, "maxLength": app_script::MAX_SCRIPT_BYTES},
                "timeoutSeconds": super::app_watch::TIMEOUT_SCHEMA.clone()
            }, "required":["app", "script"], "additionalProperties":false},
            "annotations":{"readOnlyHint":false, "destructiveHint":true, "openWorldHint":true}
        }),
    ]
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListArguments {
    #[serde(default)]
    refresh: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RunArguments {
    app: String,
    script: String,
    #[serde(default)]
    timeout_seconds: Option<u64>,
}

pub(super) fn unavailable() -> FileError {
    FileError::new(
        "not-authorized",
        "Application scripting requires an allowed client and a live terminal with a project folder.",
    )
}

/// An installed application by id, or the error that tells the agent to list them first.
pub(super) fn installed(id: &str) -> Result<App, FileError> {
    app_discovery::find(id).ok_or_else(|| {
        FileError::new(
            "unknown-app",
            format!("No scriptable application \"{id}\". Call {LIST} first."),
        )
    })
}

/// Shown in the first-use question: enough to judge a script, bounded for the dialog.
const SCRIPT_PREVIEW_CHARS: usize = 4000;

/// The script as the first-use question shows it.
pub(super) fn script_preview(script: &str) -> String {
    let mut preview: String = script.chars().take(SCRIPT_PREVIEW_CHARS).collect();
    if preview.len() < script.len() {
        preview.push_str("\n…");
    }
    preview
}

/// The user's approval for this application (asked once), then the terminal's file access.
/// `script` is the request that raised the question; the question shows it.
pub(super) fn authorize(
    app: &App,
    scope: &Arc<Scope>,
    script: Option<&str>,
    notify: &dyn Fn(Value),
) -> Result<(), FileError> {
    // Added in cairngorm.json: approved under what it points to, and labelled so.
    let detected = app_discovery::detected(false);
    let key = super::app_settings::consent_key(app, &detected);
    let label = super::app_settings::consent_label(app, &detected);
    let preview = script.map(script_preview);
    let ask = |mut event: Value| {
        if let (Some(preview), Some(fields)) = (&preview, event.as_object_mut()) {
            fields.insert("script".into(), json!(preview));
        }
        notify(event)
    };
    super::file_consent::require(scope, &format!("app:{key}"), &label, &ask)?;
    super::files::still_authorized(scope)
}

/// A visible application window is shown in a pane beside the terminal.
pub(super) fn show_window(app: &App, scope: &Scope, notify: &dyn Fn(Value), hwnd: Option<&str>) {
    let window = match hwnd {
        Some(hwnd) => super::app_window::reported_window(&app.executable, hwnd),
        None => super::app_window::main_window(&app.executable),
    };
    if let Some(window) = window {
        notify(json!({"appWindow": {
            "terminal": scope.metadata.session_id, "app": app.id, "name": app.name,
            "hwnd": window.hwnd, "title": window.title,
        }}));
    }
}

pub(super) fn call(
    params: &Value,
    scope: Option<Arc<Scope>>,
    notify: impl Fn(Value),
) -> Result<Value, (i32, String)> {
    let invalid = |message: &str| (-32602, message.to_string());
    if params["name"] == LIST {
        let arguments: ListArguments = serde_json::from_value(params["arguments"].clone())
            .map_err(|_| invalid("Expected an optional refresh flag."))?;
        if scope.is_none() {
            return Ok(result(Err(unavailable())));
        }
        let apps: Vec<Value> = app_discovery::apps(arguments.refresh)
            .iter()
            .map(|app| {
                let mut entry = json!(app);
                entry["driver"] = json!(app.driver());
                entry
            })
            .collect();
        return Ok(result(Ok(json!({
            "apps": apps,
            "drivers": { "com": RUN, "osa": RUN, "mcp": super::app_mcp_tools::CALL },
        }))));
    }
    let arguments: RunArguments = serde_json::from_value(params["arguments"].clone())
        .map_err(|_| invalid("Expected app and script."))?;
    if arguments.script.len() > app_script::MAX_SCRIPT_BYTES {
        return Err(invalid("The script is larger than 64 KiB."));
    }
    let Some(scope) = scope else {
        return Ok(result(Err(unavailable())));
    };
    let app = match installed(&arguments.app) {
        Ok(app) if app.mcp.is_some() => {
            return Ok(result(Err(FileError::new(
                "wrong-driver",
                format!(
                    "{} is driven through its own MCP server: use {} and {}.",
                    app.name,
                    super::app_mcp_tools::TOOLS,
                    super::app_mcp_tools::CALL
                ),
            ))))
        }
        Ok(app) => app,
        Err(error) => return Ok(result(Err(error))),
    };
    // The whole request (approval, busy check, waiting for its turn, the script) fits the limit.
    let begun = std::time::Instant::now();
    let timeout = super::app_watch::limit(arguments.timeout_seconds);
    let outcome = authorize(&app, &scope, Some(&arguments.script), &notify)
        .and_then(|()| super::app_busy::answering(&app, &scope, &notify))
        .and_then(|()| {
            app_script::run(
                &app,
                &arguments.script,
                scope.root.root_path(),
                timeout,
                begun,
            )
            .map_err(|e| FileError::new("script-failed", e))
        });
    // Also when stopped: a dialog it waits on is then in front of the user.
    if let Ok(run) = &outcome {
        show_window(&app, &scope, &notify, run["windowHwnd"].as_str());
    }
    // A script that failed or was stopped is an error to the agent, details included.
    let failed = outcome
        .as_ref()
        .is_ok_and(|run| run["stopped"].is_string() || run["exitCode"] != 0);
    let mut reply = result(outcome);
    if failed {
        reply["isError"] = json!(true);
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_question_shows_short_scripts_whole_and_marks_long_ones_cut() {
        assert_eq!(super::script_preview("Write-Output 1"), "Write-Output 1");
        let long = "é".repeat(5000);
        let preview = super::script_preview(&long);
        assert!(preview.ends_with("\n…"));
        assert_eq!(preview.chars().count(), super::SCRIPT_PREVIEW_CHARS + 2);
    }
}
