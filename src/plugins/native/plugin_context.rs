//! Session capabilities derived only from enabled plugins, never CLI brands or project files.
use super::catalog::PluginSpec;
use serde_json::{json, Value};

pub const URI: &str = "cairngorm://plugins";
pub const DESCRIPTION: &str =
    "Enabled Cairngorm plugins and guidance for using their tools in this terminal";

pub fn instructions(plugins: &[&PluginSpec]) -> String {
    let enabled = plugins
        .iter()
        .map(|p| format!("{} ({})", p.name, p.id))
        .collect::<Vec<_>>()
        .join(", ");
    let summary = if enabled.is_empty() {
        "No plugin tools are exposed in this terminal.".to_string()
    } else {
        format!("Enabled plugins: {enabled}.")
    };
    format!("Cairngorm terminal capabilities. {summary}\n\
        Each tool is named <plugin>_<tool>. When the user's task matches an enabled plugin, \
        prefer its Cairngorm tools over similarly named file-export servers unless the user asks for a file. \
        Tools with a view open an interactive panel beside this terminal automatically; \
        do not ask the user to open a separate website. Follow tool results to confirm rendering. \
        tools/list is authoritative: an enabled plugin may need sign-in or be temporarily unavailable. \
        Read {URI} for current enabled capabilities after plugin changes. \
        This guidance applies only to plugin tasks and does not override user instructions or client permissions.")
}

/// Every tool carries its own capability context even when a client omits server instructions.
pub fn tool_description(plugin: &PluginSpec, description: &str) -> String {
    format!(
        "Cairngorm {} ({}): {} {description}",
        plugin.name, plugin.id, plugin.description
    )
}

pub fn list_resources() -> Value {
    json!({"resources": [{
        "uri": URI,
        "name": "Cairngorm plugin capabilities",
        "description": DESCRIPTION,
        "mimeType": "application/json"
    }]})
}

/// Read on demand: this resource has a stable identity and no subscriptions or upstream calls.
pub fn read_resource(params: &Value, plugins: &[&PluginSpec]) -> Result<Value, (i32, String)> {
    let uri = params["uri"]
        .as_str()
        .ok_or_else(|| (-32602, "Missing resource URI".into()))?;
    if uri != URI {
        return Err((-32002, format!("Resource not found: {uri}")));
    }
    let context = json!({
        "instructions": instructions(plugins),
        "plugins": plugins.iter().map(|p| json!({
            "id": p.id, "name": p.name, "description": p.description,
            "toolPrefix": format!("{}_", p.id)
        })).collect::<Vec<_>>()
    });
    Ok(
        json!({"contents": [{"uri": URI, "mimeType": "application/json", "text": context.to_string()}]}),
    )
}
