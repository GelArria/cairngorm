//! Applications that ship their own MCP server on stdio (the Craft apps run
//! `<app>-cli mcp`). The catalog names the command line; nothing here is per-application:
//! an installed program is found on PATH or in the usual install folders.
use super::{app_discovery::App, catalog};
use std::path::PathBuf;

/// The application's own MCP server: a program and its arguments.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct McpServer {
    pub program: String,
    pub args: Vec<String>,
}

/// Catalog applications whose MCP server program is installed. The application's own window
/// program (named like its id) is what panes show; without one the server program stands in.
pub(super) fn installed() -> Vec<App> {
    catalog::catalog()
        .iter()
        .filter(|plugin| plugin.local_app)
        .filter_map(|plugin| {
            let (program, args) = command(plugin.mcp)?;
            let program = locate(&program, plugin.id, plugin.name)?;
            let window = locate(plugin.id, plugin.id, plugin.name).filter(|gui| gui != &program);
            Some(App {
                id: plugin.id.into(),
                name: plugin.name.into(),
                prog_id: String::new(),
                executable: window
                    .unwrap_or_else(|| program.clone())
                    .to_string_lossy()
                    .into(),
                mcp: Some(McpServer {
                    program: program.to_string_lossy().into(),
                    args,
                }),
            })
        })
        .collect()
}

/// "photocraft-cli mcp" → ("photocraft-cli", ["mcp"]). Only a bare program name is accepted,
/// so the catalog can never point at an arbitrary path.
pub(super) fn command(line: &str) -> Option<(String, Vec<String>)> {
    let mut parts = line.split_whitespace();
    let program = parts.next()?;
    let bare = program
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_');
    bare.then(|| (program.to_string(), parts.map(String::from).collect()))
}

/// A program on PATH, or in the application's per-user or per-machine install folder.
fn locate(program: &str, id: &str, name: &str) -> Option<PathBuf> {
    // Only what can be started directly (no PowerShell scripts or extensionless files).
    let launchable = |path: &PathBuf| {
        !cfg!(windows)
            || path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("cmd"))
    };
    if let Some(path) = crate::cli_catalog::find_program(program).filter(launchable) {
        return Some(path);
    }
    let file = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    };
    let mut folders = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let programs = PathBuf::from(local).join("Programs");
        folders.extend([programs.join(name), programs.join(id)]);
    }
    for base in ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
    {
        folders.extend([
            PathBuf::from(&base).join(name),
            PathBuf::from(&base).join(id),
        ]);
    }
    folders.push(PathBuf::from(format!(
        "/Applications/{name}.app/Contents/MacOS"
    )));
    folders
        .iter()
        .flat_map(|folder| [folder.join(&file), folder.join("bin").join(&file)])
        .find(|path| path.is_file())
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_app_mcp.rs"]
mod tests;
