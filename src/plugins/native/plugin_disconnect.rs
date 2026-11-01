//! Takes the shared bridge back out of every agent CLI and MCP client configuration it was
//! added to, and records that agents are no longer connected. An entry that runs another
//! install's bridge, or another server under the same name, is left alone.
use super::agent_targets::{targets, Env, Format};
use super::{agents, bridge::bridge_path, catalog, clients, config_edit, mcp_edit, mcp_servers};
use crate::integration_config::write_config;
use std::path::Path;

/// Each result names one configuration that could not be cleaned.
pub fn disconnect_all(dir: &Path, home: &Path, env: Env) -> Vec<Result<(), String>> {
    let bridge = bridge_path(dir);
    let mut results = Vec::new();
    for target in targets(home, env).iter().filter(|t| t.installed()) {
        results.push(
            unregister(&target.file, target.format, &bridge)
                .map_err(|e| format!("{}: {e}", target.file.display())),
        );
    }
    match clients::list(dir, &bridge) {
        Ok(list) => {
            for status in list.into_iter().filter(|s| s.registered) {
                results.push(clients::connect(dir, &status.client.id, &bridge, false));
            }
        }
        Err(error) => results.push(Err(error)),
    }
    // Only an explicit "Connect agents" adds the bridge again.
    results.push(catalog::disconnect_agents(dir));
    results
}

fn unregister(file: &Path, format: Format, bridge: &str) -> Result<(), String> {
    let text = agents::read(file)?;
    match agents::registration_entry(format, &text)? {
        Some(entry) if config_edit::runs_bridge(&entry, bridge) => {}
        _ => return Ok(()),
    }
    let updated = mcp_servers::edit_keeping_bom(&text, |body| match format {
        Format::Json(parent, _) => mcp_edit::remove_json(body, &[parent], config_edit::SERVER),
        Format::Toml => mcp_edit::remove_toml(body, config_edit::SERVER),
    })?;
    write_config(file, &updated)
}

#[cfg(test)]
mod tests {
    use super::super::agent_targets::Style;
    use super::*;

    #[test]
    fn only_this_installs_bridge_entry_is_removed() {
        let dir =
            std::env::temp_dir().join(format!("cairngorm-disconnect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("mcp.json");
        let format = Format::Json("mcpServers", Style::Stdio);
        let ours = r#"{
  // keep
  "mcpServers": {
    "other": { "command": "x" },
    "cairngorm": { "command": "node", "args": ["C:/data/plugins/mcp-bridge.cjs"] }
  }
}"#;
        std::fs::write(&file, ours).unwrap();
        unregister(&file, format, "C:/elsewhere/mcp-bridge.cjs").unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            ours,
            "another install's entry"
        );
        unregister(&file, format, "C:/data/plugins/mcp-bridge.cjs").unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("// keep") && text.contains("\"other\""));
        assert!(!text.contains("cairngorm"));
        unregister(&file, format, "C:/data/plugins/mcp-bridge.cjs").unwrap();
        unregister(
            &dir.join("absent.json"),
            format,
            "C:/data/plugins/mcp-bridge.cjs",
        )
        .unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }
}
