//! MCP tools for applications that bring their own MCP server (driver "mcp" in
//! `cairngorm_list_apps`): `cairngorm_app_tools` lists the application's tools and
//! `cairngorm_app_call` runs one. The server is the application's; nothing is reimplemented.
use super::{
    app_discovery::App,
    app_mcp_io::Failure,
    app_mcp_session, app_mcp_sessions,
    apps::{self, authorize, installed, show_window},
    file_runtime::Scope,
    file_scope::FileError,
    files::result,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{sync::Arc, time::Duration};

pub(super) const TOOLS: &str = "cairngorm_app_tools";
pub(super) const CALL: &str = "cairngorm_app_call";

pub(super) fn tools() -> Vec<Value> {
    let app = json!({"type":"string", "minLength":1, "maxLength":64});
    vec![
        json!({
            "name": TOOLS,
            "description": format!("List the tools of an installed application that has its own MCP server (driver \"mcp\" in {}). {}", apps::LIST, apps::GUIDANCE),
            "inputSchema": {"type":"object", "properties":{"app": app}, "required":["app"], "additionalProperties":false},
            "annotations":{"readOnlyHint":true, "destructiveHint":false, "openWorldHint":false}
        }),
        json!({
            "name": CALL,
            "description": format!("Run one of an application's own MCP tools (names and arguments from {TOOLS}) in this terminal's project folder. The application's window is shown beside the terminal when it is open. A failure says why in its code: timed-out, cancelled, app-unavailable (its server could not start), app-stopped (its server ended; the next call starts it again) or app-failed (the application's own error)."),
            "inputSchema": {"type":"object", "properties":{
                "app": app,
                "tool": {"type":"string", "minLength":1, "maxLength":128},
                "arguments": {"type":"object"},
                "timeoutSeconds": super::app_watch::TIMEOUT_SCHEMA.clone()
            }, "required":["app", "tool"], "additionalProperties":false},
            "annotations":{"readOnlyHint":false, "destructiveHint":true, "openWorldHint":true}
        }),
    ]
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Arguments {
    app: String,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default)]
    arguments: Option<Map<String, Value>>,
    #[serde(default)]
    timeout_seconds: Option<u64>,
}

fn failed(failure: Failure) -> FileError {
    FileError::new(failure.code(), failure.to_string())
}

/// The application, approved by the user, and this terminal's session with its server.
fn open(
    id: &str,
    scope: &Arc<Scope>,
    notify: &dyn Fn(Value),
) -> Result<(App, Arc<app_mcp_session::Session>), FileError> {
    let app = installed(id)?;
    let Some(server) = app.mcp.clone() else {
        return Err(FileError::new(
            "wrong-driver",
            format!(
                "{} is driven with {} (its {} automation).",
                app.name,
                apps::RUN,
                app.driver()
            ),
        ));
    };
    authorize(&app, scope, None, notify)?;
    let session = app_mcp_sessions::session(
        &scope.metadata.session_id,
        &app.id,
        &server,
        scope.root.root_path(),
    )
    .map_err(failed)?;
    Ok((app, session))
}

/// Every page of the application's tool list (at most 20 pages).
fn every_tool(session: &app_mcp_session::Session) -> Result<Vec<Value>, FileError> {
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..20 {
        let params = cursor
            .as_ref()
            .map_or(json!({}), |c| json!({ "cursor": c }));
        let page = session
            .request("tools/list", params, Duration::from_secs(30))
            .map_err(failed)?;
        tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
        cursor = page["nextCursor"].as_str().map(String::from);
        if cursor.is_none() {
            break;
        }
    }
    Ok(tools)
}

pub(super) fn call(
    params: &Value,
    scope: Option<Arc<Scope>>,
    notify: impl Fn(Value),
) -> Result<Value, (i32, String)> {
    let arguments: Arguments =
        serde_json::from_value(params["arguments"].clone()).map_err(|_| {
            (
                -32602,
                "Expected app, and for a call its tool and arguments.".into(),
            )
        })?;
    let Some(scope) = scope else {
        return Ok(result(Err(apps::unavailable())));
    };
    if params["name"] == TOOLS {
        let listed =
            open(&arguments.app, &scope, &notify).and_then(|(_, session)| every_tool(&session));
        return Ok(result(
            listed.map(|tools| json!({ "app": arguments.app, "tools": tools })),
        ));
    }
    let Some(tool) = arguments.tool else {
        return Err((-32602, "Expected the tool to run.".into()));
    };
    // Approval and starting the server count against the request's limit too.
    let begun = std::time::Instant::now();
    let limit = super::app_watch::limit(arguments.timeout_seconds);
    let called = open(&arguments.app, &scope, &notify).and_then(|(app, session)| {
        let reply = session
            .request(
                "tools/call",
                json!({ "name": tool, "arguments": arguments.arguments.unwrap_or_default() }),
                limit
                    .saturating_sub(begun.elapsed())
                    .max(Duration::from_secs(1)),
            )
            .map_err(failed)?;
        show_window(&app, &scope, &notify, None);
        Ok(reply)
    });
    // The application's own result (text, images, isError) goes back unchanged.
    Ok(match called {
        Ok(reply) if reply["content"].is_array() => reply,
        other => result(other),
    })
}
