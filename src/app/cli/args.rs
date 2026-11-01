//! Arguments of the `cairngorm` command. The terminal command and the app share this
//! parser: the command validates and resolves a request, then forwards it to the app in
//! the canonical form `Request::to_args` writes. Standard library only.
use std::path::{Path, PathBuf};

pub const PANELS: &[&str] = &["files", "git", "calendar"];

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Request {
    /// A folder to open as a project, or a file to open in the editor.
    pub path: Option<PathBuf>,
    pub terminal: bool,
    /// Agent CLI id, name or program from the app's catalog, such as `claude`.
    pub agent: Option<String>,
    pub panel: Option<String>,
    /// `Some("")` opens Settings on its last page.
    pub settings: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Parsed {
    Help,
    Version,
    Open(Request),
}

pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Parsed, String> {
    let mut request = Request::default();
    let mut args = args.into_iter();
    let mut positional_only = false;
    while let Some(arg) = args.next() {
        if positional_only || !arg.starts_with('-') {
            if request.path.is_some() {
                return Err(format!(
                    "Only one path can be opened at a time (got '{arg}')."
                ));
            }
            // Windows PowerShell 5.1 passes a completed `'.My Folder'` as `.My Folder"`.
            let arg = match arg.strip_suffix('"') {
                Some(path) if cfg!(windows) => path.to_string(),
                _ => arg,
            };
            request.path = Some(PathBuf::from(arg));
            continue;
        }
        let (flag, value) = match arg.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => (flag.to_string(), Some(value)),
            _ => (arg.clone(), None),
        };
        if value.is_some() && !matches!(flag.as_str(), "--agent" | "--settings") {
            return Err(format!("{flag} does not take a value."));
        }
        match flag.as_str() {
            "--" => positional_only = true,
            "-h" | "--help" => return Ok(Parsed::Help),
            "-v" | "-V" | "--version" => return Ok(Parsed::Version),
            "-t" | "--terminal" => request.terminal = true,
            "-a" | "--agent" => {
                let name = match value {
                    Some(value) => value.to_string(),
                    None => args
                        .next()
                        .filter(|next| !next.starts_with('-'))
                        .ok_or("--agent needs a CLI name, such as --agent claude.")?,
                };
                if !name.starts_with(|c: char| c.is_ascii_alphanumeric())
                    || name.len() > 64
                    || !name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                {
                    return Err(format!("'{name}' is not an agent CLI name."));
                }
                request.agent = Some(name);
            }
            "--settings" => {
                let page = value.unwrap_or_default();
                if !page.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                    return Err(format!("'{page}' is not a Settings page."));
                }
                request.settings = Some(page.to_string());
            }
            panel if PANELS.contains(&panel.trim_start_matches('-')) && panel.starts_with("--") => {
                let panel = panel.trim_start_matches('-').to_string();
                if request.panel.as_ref().is_some_and(|p| *p != panel) {
                    return Err("Choose one panel: --files, --git or --calendar.".into());
                }
                request.panel = Some(panel);
            }
            _ => return Err(format!("Unknown option '{arg}'. Run cairngorm --help.")),
        }
    }
    Ok(Parsed::Open(request))
}

impl Request {
    /// Makes the path absolute and checks it exists. A terminal or agent without a path
    /// opens in `cwd`, the folder the command was run from.
    pub fn resolve(mut self, cwd: &Path, home: Option<&Path>) -> Result<Self, String> {
        if self.path.is_none() && (self.terminal || self.agent.is_some()) {
            self.path = Some(cwd.to_path_buf());
        }
        if let Some(path) = self.path.take() {
            let text = path.to_string_lossy();
            let expanded = match (text.strip_prefix('~'), home) {
                (Some(""), Some(home)) => home.to_path_buf(),
                (Some(rest), Some(home)) if rest.starts_with(['/', '\\']) => home.join(&rest[1..]),
                _ => path.clone(),
            };
            // Lexical, not canonical: junctions, mapped drives and links keep the name
            // the user typed, so a project added through that name still matches.
            let absolute = lexical(&std::path::absolute(cwd.join(expanded)).unwrap_or_default());
            if !absolute.exists() {
                return Err(format!("No such file or folder: {}", path.display()));
            }
            self.path = Some(plain_path(absolute));
        }
        Ok(self)
    }

    /// True when the app only needs to come to the front.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    pub fn to_args(&self) -> Vec<String> {
        let mut args = Vec::new();
        if self.terminal {
            args.push("--terminal".to_string());
        }
        if let Some(agent) = &self.agent {
            args.push(format!("--agent={agent}"));
        }
        if let Some(panel) = &self.panel {
            args.push(format!("--{panel}"));
        }
        match self.settings.as_deref() {
            Some("") => args.push("--settings".to_string()),
            Some(page) => args.push(format!("--settings={page}")),
            None => {}
        }
        if let Some(path) = &self.path {
            args.push("--".to_string());
            args.push(path.to_string_lossy().into_owned());
        }
        args
    }
}

/// Drops `.` and resolves `..` without touching the disk.
fn lexical(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if !matches!(
                    out.components().next_back(),
                    Some(Component::RootDir | Component::Prefix(_)) | None
                ) {
                    out.pop();
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// A cwd in verbatim form (`\\?\C:\…`) would make every path verbatim; shells and the app
/// use the ordinary form.
fn plain_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path,
    }
}

pub fn help(version: &str) -> String {
    format!(
        "Cairngorm {version}
Your coding agents, terminals, files and Git in one desktop workspace.

Usage: cairngorm [path] [options]

  cairngorm                   Open Cairngorm, or bring it to the front
  cairngorm .                 Open this folder as a project
  cairngorm notes.md          Open a file in the editor, inside its project
  cairngorm -a claude         Start Claude Code in this folder
  cairngorm ~/app -t --git    Open a project with a new terminal and the Git panel

Options:
  -t, --terminal          Open a new terminal in the folder (default: this folder)
  -a, --agent <cli>       Start an installed agent CLI there: claude, codex, gemini,
                          pi, opencode, or any CLI listed in Cairngorm's New menu
      --files             Show the Files panel
      --git               Show the Git panel
      --calendar          Show scheduled tasks
      --settings[=page]   Open Settings, e.g. --settings=providers or --settings=plugins
  -v, --version           Print the version
  -h, --help              Print this help
"
    )
}
