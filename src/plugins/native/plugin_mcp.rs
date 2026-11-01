//! The MCP server agents see: enabled plugins' tools, prefixed with the plugin id.
use super::{calls, catalog::PluginSpec, context, upstream::Upstream};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

const PROTOCOLS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
pub const TOOL_TIMEOUT: Duration = Duration::from_secs(120);

/// What the gateway needs from the app to show a view for a call.
pub trait ViewHost {
    fn open(
        &self,
        call_id: &str,
        plugin: &PluginSpec,
        call: &calls::Call,
        arguments: &Value,
        view: &Value,
    );
    fn finished(&self, call_id: &str, outcome: &Result<Value, String>);
}

pub fn visible_to(tool: &Value, who: &str) -> bool {
    match tool["_meta"]["ui"]["visibility"].as_array() {
        Some(list) => list.iter().any(|v| v == who),
        None => true,
    }
}

pub fn view_uri(tool: &Value) -> Option<&str> {
    tool["_meta"]["ui"]["resourceUri"]
        .as_str()
        .or_else(|| tool["_meta"]["ui/resourceUri"].as_str())
        .filter(|uri| uri.starts_with("ui://"))
}

pub fn dispatch(
    method: &str,
    params: &Value,
    caller: super::callers::Caller,
    plugins: &[(&'static PluginSpec, Arc<Upstream>)],
    host: &dyn ViewHost,
) -> Result<Value, (i32, String)> {
    match method {
        "initialize" => Ok(initialize(params, plugins)),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(list_tools(plugins)),
        "tools/call" => call_tool(params, caller, plugins, host).map_err(|e| (-32602, e)),
        "resources/list" => Ok(context::list_resources()),
        "resources/read" => {
            context::read_resource(params, &plugins.iter().map(|(p, _)| *p).collect::<Vec<_>>())
        }
        "prompts/list" => Ok(json!({"prompts": []})),
        other => Err((-32601, format!("Method not found: {other}"))),
    }
}

pub fn initialize(params: &Value, plugins: &[(&'static PluginSpec, Arc<Upstream>)]) -> Value {
    let requested = params["protocolVersion"].as_str().unwrap_or_default();
    let version = PROTOCOLS
        .iter()
        .find(|v| **v == requested)
        .unwrap_or(&"2025-06-18");
    let mut instructions = vec![context::instructions(
        &plugins.iter().map(|(p, _)| *p).collect::<Vec<_>>(),
    )];
    for (plugin, upstream) in plugins {
        if let Some(text) = upstream.instructions() {
            instructions.push(format!(
                "{} (tools prefixed `{}_`): {text}",
                plugin.name, plugin.id
            ));
        }
    }
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": true }, "resources": {} },
        "serverInfo": { "name": "cairngorm", "title": "Cairngorm plugins", "version": env!("CARGO_PKG_VERSION") },
        "instructions": instructions.join("\n\n"),
    })
}

pub fn tool_description(tool: &Value) -> String {
    let description = tool["description"].as_str().unwrap_or_default();
    if view_uri(tool).is_some() {
        format!("Opens an interactive panel beside this terminal in Cairngorm. {description}")
    } else {
        description.to_string()
    }
}

pub fn list_tools(plugins: &[(&'static PluginSpec, Arc<Upstream>)]) -> Value {
    let mut tools = Vec::new();
    for (plugin, upstream) in plugins {
        // One unreachable server must not hide every other plugin.
        let Ok(list) = upstream
            .tools()
            .map_err(|e| eprintln!("[plugins] {}: {e}", plugin.id))
        else {
            continue;
        };
        for tool in list.iter().filter(|tool| visible_to(tool, "model")) {
            let mut entry = json!({
                "name": format!("{}_{}", plugin.id, tool["name"].as_str().unwrap_or_default()),
                "description": context::tool_description(plugin, &tool_description(tool)),
                "inputSchema": tool["inputSchema"],
            });
            for field in ["title", "annotations", "outputSchema"] {
                if !tool[field].is_null() {
                    entry[field] = tool[field].clone();
                }
            }
            tools.push(entry);
        }
    }
    json!({ "tools": tools })
}

pub fn call_tool(
    params: &Value,
    caller: super::callers::Caller,
    plugins: &[(&'static PluginSpec, Arc<Upstream>)],
    host: &dyn ViewHost,
) -> Result<Value, String> {
    let name = params["name"].as_str().ok_or("Missing tool name")?;
    let (plugin, upstream, tool_name) = plugins
        .iter()
        .find_map(|(plugin, upstream)| {
            let rest = name.strip_prefix(plugin.id)?.strip_prefix('_')?;
            Some((*plugin, upstream, rest))
        })
        .ok_or_else(|| format!("{name} is not an enabled Cairngorm plugin tool"))?;
    let tool = upstream.tool(tool_name)?;
    if !visible_to(&tool, "model") {
        return Err(format!("{name} is only available to the plugin view"));
    }
    let declared_output = !tool["outputSchema"].is_null();
    let arguments = params["arguments"].clone();
    let upstream_params = json!({ "name": tool_name, "arguments": arguments });
    let earlier = calls::take_pending(plugin.id, caller.terminal.as_deref());
    // A view that cannot load degrades to a plain tool call, as hosts without MCP Apps do.
    let view = view_uri(&tool).and_then(|uri| {
        upstream
            .view(uri)
            .map_err(|e| eprintln!("[plugins] {}: {e}", plugin.id))
            .ok()
    });
    let Some(view) = view else {
        let result = upstream.request("tools/call", upstream_params, TOOL_TIMEOUT);
        return Ok(calls::compose(
            tool_error(result),
            earlier,
            None,
            plugin.name,
            declared_output,
        ));
    };
    let (call_id, call) = calls::start(plugin.id, caller.terminal, caller.agent, tool);
    super::canvas::bind(&call, &arguments)?;
    host.open(&call_id, plugin, &call, &arguments, &view["_meta"]["ui"]);
    let outcome = upstream
        .request("tools/call", upstream_params, TOOL_TIMEOUT)
        .and_then(|result| {
            super::canvas::bind(&call, &result["structuredContent"])?;
            Ok(result)
        });
    calls::upstream_finished(&call);
    host.finished(&call_id, &outcome);
    let settled = outcome.is_ok().then(|| calls::settle(&call));
    calls::complete(&call);
    Ok(calls::compose(
        tool_error(outcome),
        earlier,
        settled,
        plugin.name,
        declared_output,
    ))
}

/// Tool failures are results the model can read, not protocol errors.
fn tool_error(outcome: Result<Value, String>) -> Value {
    outcome.unwrap_or_else(
        |message| json!({ "content": [{ "type": "text", "text": message }], "isError": true }),
    )
}

fn sources(meta: &Value, key: &str) -> String {
    meta["csp"][key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|s| valid_source(s))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Declared origins only: no keywords, schemes-at-large or directive injection.
fn valid_source(source: &str) -> bool {
    if matches!(source, "blob:" | "data:") {
        return true;
    }
    let Some(rest) = source
        .strip_prefix("https://")
        .or_else(|| source.strip_prefix("wss://"))
    else {
        return false;
    };
    let host = rest.split(['/', ':']).next().unwrap_or_default();
    // A wildcard may only lead a real domain: `*.example.com`, never `*` or `*.com`.
    let named = host.strip_prefix("*.").unwrap_or(host);
    source.len() <= 256
        && named.contains('.')
        && named.split('.').all(|label| {
            !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
        && rest
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-.:*/_".contains(c))
}

/// The view's CSP from its declared domains (MCP Apps reference host policy).
pub fn content_security_policy(meta: &Value) -> String {
    let resources = sources(meta, "resourceDomains");
    let connect = sources(meta, "connectDomains");
    let frames = sources(meta, "frameDomains");
    let bases = sources(meta, "baseUriDomains");
    let directives = [
        "default-src 'none'".to_string(),
        format!("script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: {resources}"),
        format!("style-src 'self' 'unsafe-inline' blob: data: {resources}"),
        format!("img-src 'self' data: blob: {resources}"),
        format!("font-src 'self' data: blob: {resources}"),
        format!("media-src 'self' data: blob: {resources}"),
        // Not 'self': the view must never reach the gateway that serves it.
        format!("connect-src blob: data: {connect}"),
        format!("worker-src 'self' blob: {resources}"),
        if frames.is_empty() {
            "frame-src 'none'".to_string()
        } else {
            format!("frame-src {frames}")
        },
        if bases.is_empty() {
            "base-uri 'self'".to_string()
        } else {
            format!("base-uri {bases}")
        },
        "object-src 'none'".to_string(),
        "form-action 'none'".to_string(),
    ];
    directives
        .iter()
        .map(|d| d.trim().to_string())
        .collect::<Vec<_>>()
        .join("; ")
}
