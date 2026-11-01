//! Loopback gateway: `/mcp` for agent bridges (bearer secret) and `/view/<call>` for views.
use super::{
    calls, catalog, http,
    mcp::{self, ViewHost},
    scope::{self, Upstreams},
    upstream::Upstream,
};
use serde_json::{json, Value};
use std::{
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::AppHandle;

/// Tool calls hold their connection while the view works; this bounds the threads.
const MAX_CONNECTIONS: usize = 64;

pub struct Gateway {
    pub origin: String,
    secret: String,
    epoch: String,
    dir: PathBuf,
    app: AppHandle,
    upstreams: Upstreams,
    active: AtomicUsize,
}

/// Only a started gateway is kept: a failed start (say, an unwritable data folder) retries.
static GATEWAY: Mutex<Option<Arc<Gateway>>> = Mutex::new(None);

pub fn running() -> Option<Arc<Gateway>> {
    GATEWAY.lock().ok()?.clone()
}

pub fn ensure(app: &AppHandle, dir: PathBuf) -> Result<Arc<Gateway>, String> {
    let mut slot = GATEWAY.lock().map_err(|e| e.to_string())?;
    if let Some(gateway) = slot.as_ref() {
        return Ok(gateway.clone());
    }
    let gateway = start(app.clone(), dir)?;
    *slot = Some(gateway.clone());
    Ok(gateway)
}

/// The previous port when free: views keep their origin, and so their storage, across runs.
fn bind(dir: &std::path::Path) -> std::io::Result<TcpListener> {
    let previous = std::fs::read_to_string(dir.join("gateway.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v["url"].as_str()?.rsplit(':').next()?.parse::<u16>().ok());
    previous
        .and_then(|port| TcpListener::bind(("127.0.0.1", port)).ok())
        .map_or_else(|| TcpListener::bind(("127.0.0.1", 0)), Ok)
}

/// Frees a connection slot however the handler ends, panics included.
struct Slot(Arc<Gateway>);

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

fn start(app: AppHandle, dir: PathBuf) -> Result<Arc<Gateway>, String> {
    let listener = bind(&dir).map_err(|e| e.to_string())?;
    let origin = format!(
        "http://{}",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    let secret = uuid::Uuid::new_v4().simple().to_string();
    // Bridges re-read this per message, so restarting Cairngorm heals running agents.
    let discovery = json!({ "url": origin, "secret": secret, "pid": std::process::id() });
    super::bridge::write_private(&dir.join("gateway.json"), &discovery.to_string())?;
    let gateway = Arc::new(Gateway {
        origin,
        secret,
        epoch: uuid::Uuid::new_v4().to_string(),
        dir,
        app,
        upstreams: Upstreams::default(),
        active: AtomicUsize::new(0),
    });
    let server = gateway.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else {
                // Repeated accept failures (descriptor exhaustion) must not spin a core.
                std::thread::sleep(Duration::from_millis(100));
                continue;
            };
            let gateway = server.clone();
            if gateway.active.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                gateway.active.fetch_sub(1, Ordering::SeqCst);
                let mut stream = stream;
                http::respond(&mut stream, "503 Service Unavailable", &[], b"");
                continue;
            }
            std::thread::spawn(move || {
                let slot = Slot(gateway);
                handle(&slot.0, stream);
            });
        }
    });
    Ok(gateway)
}

impl Gateway {
    pub fn revision(&self) -> String {
        format!("{}:{}", self.epoch, catalog::revision())
    }

    pub fn upstream(&self, plugin: &str, terminal: Option<&str>) -> Option<Arc<Upstream>> {
        Some(self.upstreams.get(catalog::find(plugin)?, terminal?))
    }

    pub fn reset_upstream(&self, plugin: &str) {
        self.upstreams.reset(plugin);
    }

    fn enabled(
        &self,
        terminal: Option<&str>,
    ) -> Vec<(&'static catalog::PluginSpec, Arc<Upstream>)> {
        catalog::enabled(&self.dir)
            .into_iter()
            .filter(|p| !p.local_app)
            .filter_map(|p| Some((p, self.upstream(p.id, terminal)?)))
            .collect()
    }
}

impl ViewHost for Gateway {
    fn open(
        &self,
        id: &str,
        plugin: &catalog::PluginSpec,
        call: &calls::Call,
        arguments: &Value,
        view: &Value,
    ) {
        let payload = json!({
            "id": id,
            "plugin": plugin.id,
            "pluginName": plugin.name,
            "pluginLogo": plugin.logo,
            "terminal": call.terminal,
            "agent": call.agent.map(|id| json!({ "id": id, "name": super::callers::agent_name(id) })),
            "tool": call.tool,
            "arguments": arguments,
            "viewUrl": format!("{}/view/{id}", scope::view_origin(&self.origin, plugin.id, call.terminal.as_deref().unwrap_or(id))),
            "view": view,
        });
        crate::emit_safe::emit_bg(&self.app, "plugin-call", payload);
    }

    fn finished(&self, id: &str, outcome: &Result<Value, String>) {
        let payload = match outcome {
            Ok(result) => json!({ "id": id, "result": result }),
            Err(error) => json!({ "id": id, "error": error }),
        };
        crate::emit_safe::emit_bg(&self.app, "plugin-call-result", payload);
    }
}

fn handle(gateway: &Gateway, mut stream: TcpStream) {
    let Ok(request) = http::read_request(&mut stream) else {
        http::respond(&mut stream, "400 Bad Request", &[], b"");
        return;
    };
    // Document provider hosts are served only by the documents module, never as MCP or views.
    if let Some(response) = crate::documents::serve_request(
        &gateway.origin,
        &request.method,
        &request.path,
        request.header("host"),
    ) {
        http::respond(
            &mut stream,
            response.status,
            &response.headers,
            &response.body,
        );
        return;
    }
    if request.method == "GET" && request.path == "/catalog" && authorized(gateway, &request) {
        let body = json!({ "revision": gateway.revision() }).to_string();
        http::respond(
            &mut stream,
            "200 OK",
            &[("Content-Type", "application/json".into())],
            body.as_bytes(),
        );
    } else if request.method == "POST" && request.path == "/mcp" {
        serve_mcp(gateway, &request, &mut stream);
    } else if let Some(id) = request
        .path
        .strip_prefix("/view/")
        .filter(|_| request.method == "GET")
    {
        serve_view(gateway, id, request.header("host"), &mut stream);
    } else {
        http::respond(&mut stream, "404 Not Found", &[], b"");
    }
}

fn authorized(gateway: &Gateway, request: &http::Request) -> bool {
    request.header("authorization") == Some(&format!("Bearer {}", gateway.secret))
        && request.header("origin").is_none()
        && request.header("host") == gateway.origin.strip_prefix("http://")
}

fn serve_mcp(gateway: &Gateway, request: &http::Request, stream: &mut TcpStream) {
    // Bridges are not browsers: a page in any webview must never drive agent tools.
    if !authorized(gateway, request) {
        http::respond(stream, "403 Forbidden", &[], b"");
        return;
    }
    let Ok(message) = serde_json::from_slice::<Value>(&request.body) else {
        http::respond(stream, "400 Bad Request", &[], b"");
        return;
    };
    if message["id"].is_null() {
        if message["method"] == "notifications/cancelled" {
            super::app_cancel::cancel(
                request.header("x-cairngorm-pid"),
                &message["params"]["requestId"],
            );
        }
        http::respond(stream, "202 Accepted", &[], b"");
        return;
    }
    // Cancelled by the client, or by the client hanging up, while it runs.
    let _request = super::app_cancel::begin(
        request.header("x-cairngorm-pid"),
        &message["id"],
        stream.try_clone().ok(),
    );
    let caller = super::callers::identify(
        request.header("x-cairngorm-client"),
        request.header("x-cairngorm-terminal"),
        request.header("x-cairngorm-pid"),
    );
    // Agents outside Cairngorm terminals (an editor, another app) get no plugin tools:
    // a view must open next to the terminal that asked for it.
    let registration = request
        .header("x-cairngorm-registration")
        .filter(|id| !id.is_empty());
    let allowed = registration_allowed(gateway, registration);
    let plugins = if caller.terminal.is_some() && allowed {
        gateway.enabled(caller.terminal.as_deref())
    } else {
        Vec::new()
    };
    let params = &message["params"];
    let revision = gateway.revision();
    let files = if catalog::files_offered(&gateway.dir) && catalog::agents_connected(&gateway.dir) {
        super::files::eligible(
            caller.terminal.as_deref(),
            file_client_allowed(gateway, request, &caller, registration),
            true,
            crate::pty::session_exists,
        )
    } else {
        None
    };
    let outcome = super::file_dispatch::dispatch(
        message["method"].as_str().unwrap_or_default(),
        params,
        caller.clone(),
        &plugins,
        gateway,
        files,
        |payload| {
            // Approvals by default; an application window to show is the only other event.
            let (event, payload) = match payload.get("appWindow") {
                Some(window) => ("app-window-open", window.clone()),
                None => ("plugin-file-permission", payload),
            };
            if let Err(error) = crate::emit_safe::emit_to_main(&gateway.app, event, payload) {
                eprintln!("[plugins] File approval could not be delivered: {error}");
            }
        },
    );
    let outcome = outcome.map(|result| {
        let file_call = message["method"] == "tools/call"
            && matches!(
                params["name"].as_str(),
                Some(super::files::READ | super::files::LIST)
            );
        if file_call
            && (!file_client_allowed(gateway, request, &caller, registration)
                || !catalog::files_offered(&gateway.dir)
                || !catalog::agents_connected(&gateway.dir))
        {
            return super::files::result(Err(super::file_scope::FileError::new(
                "scope-revoked",
                "File access or the client connection was revoked.",
            )));
        }
        result
    });
    let reply = match outcome {
        Ok(mut result) => {
            if message["method"] == "initialize" || message["method"] == "tools/list" {
                result["_meta"]["cairngorm/revision"] = json!(revision);
            }
            super::activity::record(
                &caller,
                request.header("x-cairngorm-pid"),
                request.header("x-cairngorm-registration"),
                &message,
                &result,
                &revision,
            );
            json!({ "jsonrpc": "2.0", "id": message["id"], "result": result })
        }
        Err((code, error)) => json!({
            "jsonrpc": "2.0", "id": message["id"], "error": { "code": code, "message": error }
        }),
    };
    let headers = [("Content-Type", "application/json".to_string())];
    http::respond(stream, "200 OK", &headers, reply.to_string().as_bytes());
}

fn file_client_allowed(
    gateway: &Gateway,
    request: &http::Request,
    caller: &super::callers::Caller,
    registration: Option<&str>,
) -> bool {
    let process = if registration.is_none() {
        // Do not trust clientInfo or the inherited terminal hint for built-in agent identity.
        super::terminal::resolve(None, request.header("x-cairngorm-pid"))
    } else {
        super::terminal::Found::default()
    };
    let agent = process.verified_agent(caller.terminal.as_deref());
    super::file_clients::allowed(
        &gateway.dir,
        &super::bridge::home(),
        &super::bridge::env,
        &super::bridge::bridge_path(&gateway.dir),
        registration,
        agent,
    )
}

fn registration_allowed(gateway: &Gateway, registration: Option<&str>) -> bool {
    registration.is_none_or(|id| {
        super::clients::list(&gateway.dir, &super::bridge::bridge_path(&gateway.dir))
            .is_ok_and(|clients| clients.iter().any(|c| c.client.id == id && c.registered))
    })
}

/// Call ids are unguessable; they are the capability to load that view.
fn serve_view(gateway: &Gateway, id: &str, host: Option<&str>, stream: &mut TcpStream) {
    let found = calls::get(id)
        .filter(|call| {
            scope::matches_view_host(
                &gateway.origin,
                host,
                call.plugin,
                call.terminal.as_deref().unwrap_or(id),
            )
        })
        .and_then(|call| {
            let uri = mcp::view_uri(&call.tool)?.to_string();
            let prepared = call.prepared_view.lock().ok()?.take();
            let view = prepared.or_else(|| {
                gateway
                    .upstream(call.plugin, call.terminal.as_deref())?
                    .view(&uri)
                    .ok()
            })?;
            let css = catalog::find(call.plugin)?.view_css;
            Some((call, view, css))
        });
    let Some((call, view, css)) = found else {
        http::respond(stream, "404 Not Found", &[], b"");
        return;
    };
    let headers = [
        ("Content-Type", "text/html; charset=utf-8".to_string()),
        (
            "Content-Security-Policy",
            mcp::content_security_policy(&view["_meta"]["ui"]),
        ),
        ("Cache-Control", "no-store".to_string()),
        ("Referrer-Policy", "no-referrer".to_string()),
    ];
    let html = match super::canvas::restore_html(&call, view["text"].as_str().unwrap_or_default()) {
        Ok(html) => with_view_host(&html, css),
        Err(error) => {
            http::respond(
                stream,
                "409 Conflict",
                &[("Content-Type", "text/plain; charset=utf-8".into())],
                error.as_bytes(),
            );
            return;
        }
    };
    http::respond(stream, "200 OK", &headers, html.as_bytes());
}

/// Append host behavior and catalog CSS without parsing closing tags inside scripts.
/// A trailing style is moved into the body by the parser and wins the cascade.
pub fn with_view_host(html: &str, css: &str) -> String {
    let script = include_str!("../assets/view-context-menu.js");
    let hosted = format!("{html}<script data-cairngorm>{script}</script>");
    if css.is_empty() {
        return hosted;
    }
    format!("{hosted}<style data-cairngorm>{css}</style>")
}
