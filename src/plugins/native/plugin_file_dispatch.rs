//! Add built-ins only at the authenticated agent gateway, never the iframe proxy.
use super::{
    app_mcp_tools, apps,
    callers::Caller,
    catalog::PluginSpec,
    file_runtime::Scope,
    files,
    mcp::{self, ViewHost},
    upstream::Upstream,
};
use serde_json::{json, Value};
use std::sync::Arc;

#[cfg(test)]
#[path = "../../../tests/native/plugin_file_dispatch.rs"]
mod tests;

pub(super) fn dispatch(
    method: &str,
    params: &Value,
    caller: Caller,
    plugins: &[(&'static PluginSpec, Arc<Upstream>)],
    host: &dyn ViewHost,
    scope: Option<Arc<Scope>>,
    notify: impl Fn(Value),
) -> Result<Value, (i32, String)> {
    if method == "tools/call"
        && matches!(
            params["name"].as_str(),
            Some(files::READ | files::LIST | files::OPEN | files::OPERATE | files::CREATE)
        )
    {
        return files::call(params, scope, notify);
    }
    if method == "tools/call" && matches!(params["name"].as_str(), Some(apps::LIST | apps::RUN)) {
        return apps::call(params, scope, notify);
    }
    if method == "tools/call"
        && matches!(
            params["name"].as_str(),
            Some(app_mcp_tools::TOOLS | app_mcp_tools::CALL)
        )
    {
        return app_mcp_tools::call(params, scope, notify);
    }
    let mut result = mcp::dispatch(method, params, caller, plugins, host)?;
    if scope.is_some() {
        match method {
            "tools/list" => {
                if let Some(tools) = result["tools"].as_array_mut() {
                    tools.extend(files::tools());
                    tools.extend(apps::tools());
                    tools.extend(app_mcp_tools::tools());
                }
            }
            "initialize" => {
                let instructions = result["instructions"].as_str().unwrap_or_default();
                result["instructions"] = json!(format!(
                    "{instructions}\n\n{}\n\n{}",
                    files::GUIDANCE,
                    apps::GUIDANCE
                ));
            }
            "resources/read" => {
                if let Some(contents) = result["contents"].as_array_mut() {
                    for content in contents {
                        if content["uri"] != super::context::URI {
                            continue;
                        }
                        if let Some(mut context) = content["text"]
                            .as_str()
                            .and_then(|s| serde_json::from_str::<Value>(s).ok())
                        {
                            context["files"] = json!({"tools":[files::LIST, files::READ, files::OPEN, files::CREATE, files::OPERATE], "instructions":files::GUIDANCE});
                            content["text"] = json!(context.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    Ok(result)
}
