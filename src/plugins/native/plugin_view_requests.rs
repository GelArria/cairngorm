//! View-only upstream dispatch and reload preparation; no application/terminal commands.
use super::{
    calls::{self, Call},
    canvas, mcp,
    upstream::Upstream,
};
use serde_json::{json, Value};
use std::time::Duration;

pub fn request(
    call: &Call,
    upstream: &Upstream,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if call.revoked.load(std::sync::atomic::Ordering::Acquire) {
        return Err("The source terminal has closed.".into());
    }
    match method {
        "tools/call" => {
            let name = params["name"].as_str().ok_or("Missing tool name")?;
            let tool = upstream.view_tool(name)?;
            if !mcp::visible_to(&tool, "app") {
                return Err(format!("{name} is not available to views"));
            }
            let checkpoint = if call.plugin == "tldraw" && name == "save_checkpoint" {
                canvas::checkpoint(call, &params["arguments"])?
            } else {
                None
            };
            let result = upstream.request(
                "tools/call",
                json!({"name":name,"arguments":params["arguments"]}),
                mcp::TOOL_TIMEOUT,
            )?;
            if result["isError"] != true {
                if let Some(checkpoint) = checkpoint {
                    canvas::acknowledge(call, checkpoint)?;
                }
            }
            Ok(result)
        }
        "resources/read" => {
            let uri = params["uri"].as_str().ok_or("Missing resource")?;
            upstream.request("resources/read", json!({"uri":uri}), mcp::TOOL_TIMEOUT)
        }
        "ping" => Ok(json!({})),
        other => Err(format!("{other} is not supported")),
    }
}

pub fn prepare_reload(call: &Call, upstream: &Upstream) -> Result<(), String> {
    if calls::opening_call_running(call) {
        return Err(
            "The opening tool call is still working. Try reloading after it finishes.".into(),
        );
    }
    canvas::ensure_reloadable(call)?;
    let uri = mcp::view_uri(&call.tool).ok_or("This call has no view resource.")?;
    let view = upstream.refresh_view(uri, Duration::from_secs(5))?;
    canvas::restore_html(
        call,
        view["text"]
            .as_str()
            .ok_or("The plugin returned no view HTML.")?,
    )?;
    if call.revoked.load(std::sync::atomic::Ordering::Acquire) {
        return Err("The source terminal has closed.".into());
    }
    *call.prepared_view.lock().map_err(|e| e.to_string())? = Some(view);
    Ok(())
}
