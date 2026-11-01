//! MCP Streamable HTTP client for one catalog server within one terminal.
use super::{
    catalog::{Auth, PluginSpec},
    tokens,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Read,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

const PROTOCOL: &str = "2025-06-18";
pub const UI_MIME: &str = "text/html;profile=mcp-app";
const MAX_RESPONSE: u64 = 16 * 1024 * 1024;

struct Session {
    id: Option<String>,
    instructions: Option<String>,
}

enum PostError {
    SessionExpired,
    /// Only between `send` and `post`, which renews the token or gives up.
    Unauthorized,
    Failed(String),
}

impl PostError {
    fn message(self) -> String {
        match self {
            Self::SessionExpired => "The plugin session expired".into(),
            Self::Unauthorized => "The plugin refused the sign-in".into(),
            Self::Failed(message) => message,
        }
    }
}

pub struct Upstream {
    plugin: &'static PluginSpec,
    /// Built once for the plugin's fixed address; a proxy or certificate setting error is
    /// reported on every request instead of failing plugin startup.
    agent: Result<ureq::Agent, String>,
    session: Mutex<Option<Session>>,
    tools: Mutex<Option<Vec<Value>>>,
    views: Mutex<HashMap<String, Value>>,
    next_id: AtomicU64,
}

impl Upstream {
    pub fn new(plugin: &'static PluginSpec) -> Self {
        Self {
            plugin,
            agent: crate::http_transport::agent_builder(plugin.server_url)
                .map(|builder| builder.timeout_connect(Duration::from_secs(10)).build()),
            session: Mutex::new(None),
            tools: Mutex::new(None),
            views: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    /// After a sign-in or sign-out: another account may see other tools and views.
    pub fn reset(&self) {
        *self.session.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *self.tools.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.views.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    pub fn instructions(&self) -> Option<String> {
        self.session_id().ok()?;
        let guard = self.session.lock().ok()?;
        guard.as_ref()?.instructions.clone()
    }

    /// Every tool, including app-only ones; callers filter by visibility.
    pub fn tools(&self) -> Result<Vec<Value>, String> {
        if let Some(tools) = self.tools.lock().map_err(|e| e.to_string())?.clone() {
            return Ok(tools);
        }
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..20 {
            let params = cursor
                .as_ref()
                .map_or(json!({}), |c| json!({ "cursor": c }));
            let page = self.request("tools/list", params, Duration::from_secs(20))?;
            tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
            cursor = page["nextCursor"].as_str().map(String::from);
            if cursor.is_none() {
                break;
            }
        }
        *self.tools.lock().map_err(|e| e.to_string())? = Some(tools.clone());
        Ok(tools)
    }

    pub fn tool(&self, name: &str) -> Result<Value, String> {
        self.tools()?
            .into_iter()
            .find(|tool| tool["name"] == name)
            .ok_or_else(|| format!("Unknown tool {name}"))
    }

    /// App-only inventories can change while an older view is still mounted.
    pub fn view_tool(&self, name: &str) -> Result<Value, String> {
        if let Some(tool) = self.tools()?.into_iter().find(|tool| tool["name"] == name) {
            return Ok(tool);
        }
        *self.tools.lock().map_err(|e| e.to_string())? = None;
        self.tool(name)
    }

    /// The `ui://` resource content (HTML text plus `_meta.ui`), cached per app session.
    pub fn view(&self, uri: &str) -> Result<Value, String> {
        if let Some(view) = self.views.lock().map_err(|e| e.to_string())?.get(uri) {
            return Ok(view.clone());
        }
        self.refresh_view(uri, Duration::from_secs(60))
    }

    /// Refresh in the same session, keeping the previous content if the read fails.
    pub fn refresh_view(&self, uri: &str, timeout: Duration) -> Result<Value, String> {
        let result = self.request("resources/read", json!({ "uri": uri }), timeout)?;
        let mut content = result["contents"]
            .as_array()
            .and_then(|items| items.iter().find(|c| c["uri"] == uri).or(items.first()))
            .cloned()
            .ok_or("The plugin returned no view")?;
        if content["mimeType"] != UI_MIME {
            return Err("The plugin view is not an MCP App".into());
        }
        if let Some(blob) = content["blob"].as_str() {
            let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, blob)
                .map_err(|e| e.to_string())?;
            content["text"] = Value::String(String::from_utf8(bytes).map_err(|e| e.to_string())?);
        }
        if !content["text"].is_string() {
            return Err("The plugin view has no HTML".into());
        }
        self.views
            .lock()
            .map_err(|e| e.to_string())?
            .insert(uri.to_string(), content.clone());
        Ok(content)
    }

    pub fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        for attempt in 0..2 {
            let session = self.session_id()?;
            let id = self.next_id.fetch_add(1, Ordering::Relaxed);
            let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
            match self.post(session.as_deref(), &body, timeout) {
                Err(PostError::SessionExpired) if attempt == 0 => {
                    // Servers may drop idle sessions; start a fresh one once.
                    *self.session.lock().map_err(|e| e.to_string())? = None;
                }
                Err(PostError::SessionExpired) => return Err("The plugin session expired".into()),
                Err(error) => return Err(error.message()),
                Ok((None, _)) => return Err("The plugin sent no response".into()),
                Ok((Some(message), _)) => {
                    if let Some(error) = message.get("error") {
                        return Err(error["message"]
                            .as_str()
                            .unwrap_or("The plugin reported an error")
                            .to_string());
                    }
                    let result = message["result"].clone();
                    if method == "tools/call" && result["isError"] != true {
                        let read_only = self
                            .tools
                            .lock()
                            .map_err(|e| e.to_string())?
                            .as_ref()
                            .and_then(|tools| {
                                tools.iter().find(|tool| tool["name"] == params["name"])
                            })
                            .is_some_and(|tool| tool["annotations"]["readOnlyHint"] == true);
                        if !read_only {
                            self.views.lock().map_err(|e| e.to_string())?.clear();
                        }
                    }
                    return Ok(result);
                }
            }
        }
        Err("The plugin session expired".into())
    }

    fn session_id(&self) -> Result<Option<String>, String> {
        let mut guard = self.session.lock().map_err(|e| e.to_string())?;
        if let Some(session) = guard.as_ref() {
            return Ok(session.id.clone());
        }
        let init = json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL,
                "capabilities": {
                    "extensions": { "io.modelcontextprotocol/ui": { "mimeTypes": [UI_MIME] } }
                },
                "clientInfo": { "name": "Cairngorm", "version": env!("CARGO_PKG_VERSION") }
            }
        });
        let (message, id) = match self.post(None, &init, Duration::from_secs(20)) {
            Ok(response) => response,
            Err(PostError::SessionExpired) => return Err("The plugin refused the session".into()),
            Err(error) => return Err(error.message()),
        };
        let message = message.ok_or("The plugin did not initialize")?;
        if message.get("error").is_some() {
            return Err("The plugin refused to initialize".into());
        }
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        // A refused notification surfaces on the next request, which re-initializes.
        let _ = self.post(id.as_deref(), &note, Duration::from_secs(10));
        *guard = Some(Session {
            id: id.clone(),
            instructions: message["result"]["instructions"].as_str().map(String::from),
        });
        Ok(id)
    }

    /// Signed-in plugins carry a bearer token. A rejected token is renewed once; a second
    /// rejection means the sign-in itself is gone.
    fn post(
        &self,
        session: Option<&str>,
        body: &Value,
        timeout: Duration,
    ) -> Result<(Option<Value>, Option<String>), PostError> {
        if self.plugin.auth != Auth::OAuth {
            return self.send(session, body, timeout, None);
        }
        let (id, name) = (self.plugin.id, self.plugin.name);
        let mut refused = String::new();
        for _ in 0..2 {
            let token = tokens::bearer(id, name).map_err(PostError::Failed)?;
            match self.send(session, body, timeout, Some(&token)) {
                Err(PostError::Unauthorized) => tokens::rejected(id, &token),
                other => return other,
            }
            refused = token;
        }
        // Only the sign-in that was refused: a sign-in completed meanwhile stays.
        tokens::forget_rejected(id, &refused);
        Err(PostError::Failed(format!(
            "Sign in to {name} again in Settings ▸ Plugins."
        )))
    }

    fn send(
        &self,
        session: Option<&str>,
        body: &Value,
        timeout: Duration,
        token: Option<&str>,
    ) -> Result<(Option<Value>, Option<String>), PostError> {
        let agent = self
            .agent
            .as_ref()
            .map_err(|message| PostError::Failed(message.clone()))?;
        let mut request = agent
            .post(self.plugin.server_url)
            .timeout(timeout)
            .set("content-type", "application/json")
            .set("accept", "application/json, text/event-stream")
            .set("mcp-protocol-version", PROTOCOL);
        if let Some(id) = session {
            request = request.set("mcp-session-id", id);
        }
        if let Some(token) = token {
            request = request.set("authorization", &format!("Bearer {token}"));
        }
        let response = match request.send_string(&body.to_string()) {
            Ok(response) => response,
            Err(ureq::Error::Status(401, _)) if token.is_some() => {
                return Err(PostError::Unauthorized)
            }
            Err(ureq::Error::Status(404, _)) if session.is_some() => {
                return Err(PostError::SessionExpired)
            }
            Err(ureq::Error::Status(code, _)) => {
                return Err(PostError::Failed(format!(
                    "The plugin server answered {code}"
                )))
            }
            Err(error) => {
                return Err(PostError::Failed(format!(
                    "Could not reach the plugin server: {error}"
                )))
            }
        };
        let id = response.header("mcp-session-id").map(String::from);
        let sse = response.content_type() == "text/event-stream";
        let mut text = String::new();
        response
            .into_reader()
            .take(MAX_RESPONSE)
            .read_to_string(&mut text)
            .map_err(|e| PostError::Failed(e.to_string()))?;
        Ok((response_message(&text, sse, &body["id"]), id))
    }
}

/// The JSON-RPC response for `id` from a JSON body or an SSE stream.
pub fn response_message(text: &str, sse: bool, id: &Value) -> Option<Value> {
    if id.is_null() {
        return None;
    }
    if !sse {
        return serde_json::from_str(text).ok();
    }
    text.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .filter_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
        .find(|message| &message["id"] == id)
}
