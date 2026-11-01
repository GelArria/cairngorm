//! User-entered paths are data, never a shell command line.
use std::{
    io::Read,
    path::{Path, PathBuf},
};

/// Node's main-module loader rejects verbatim disk paths returned by canonicalize.
pub(crate) fn node_script_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    if let Some(std::path::Component::Prefix(prefix)) = path.components().next() {
        if let std::path::Prefix::VerbatimDisk(drive) = prefix.kind() {
            let mut plain = PathBuf::from(format!("{}:\\", drive as char));
            plain.extend(path.components().skip(2));
            return plain;
        }
    }
    path.to_path_buf()
}

/// Folders where official installers, package managers and Node version managers put
/// CLIs. An app opened from a desktop launcher often gets a shorter PATH than the shell.
pub(crate) fn extra_dirs() -> Vec<PathBuf> {
    let home = crate::ai_cli::home();
    let mut in_home = vec![
        ".local/bin",
        ".claude/local",
        ".bun/bin",
        ".npm-global/bin",
        ".volta/bin",
        ".yarn/bin",
    ];
    let mut dirs = Vec::new();
    if cfg!(windows) {
        in_home.push("scoop/shims");
        let from_env = [
            ("APPDATA", "npm"),
            ("LOCALAPPDATA", "pnpm"),
            ("LOCALAPPDATA", "Volta/bin"),
            ("NVM_SYMLINK", "."),
        ];
        dirs.extend(from_env.iter().filter_map(|(var, sub)| {
            std::env::var_os(var).map(|base| PathBuf::from(base).join(sub))
        }));
    } else {
        in_home.extend([
            ".local/share/pnpm",
            "Library/pnpm",
            ".asdf/shims",
            ".local/share/mise/shims",
            ".local/share/fnm/aliases/default/bin",
            "Library/Application Support/fnm/aliases/default/bin",
        ]);
        dirs.extend(
            [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/home/linuxbrew/.linuxbrew/bin",
            ]
            .map(PathBuf::from),
        );
        dirs.extend(nvm_bins(&home.join(".nvm/versions/node")));
    }
    in_home
        .iter()
        .map(|dir| home.join(dir))
        .chain(dirs)
        .collect()
}

/// nvm's Node versions, newest first.
pub(crate) fn nvm_bins(root: &Path) -> Vec<PathBuf> {
    let version = |path: &PathBuf| -> Vec<u32> {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        name.trim_start_matches('v')
            .split('.')
            .map(|n| n.parse().unwrap_or(0))
            .collect()
    };
    let mut versions: Vec<PathBuf> = std::fs::read_dir(root)
        .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    versions.sort_by_key(|path| std::cmp::Reverse(version(path)));
    versions.into_iter().map(|path| path.join("bin")).collect()
}

/// PATH followed by the existing folders from `extra_dirs`.
pub(crate) fn search_path() -> std::ffi::OsString {
    let path = std::env::var_os("PATH").unwrap_or_default();
    // Without a home folder the home entries would be relative to the app's folder.
    let extra = extra_dirs()
        .into_iter()
        .filter(|dir| dir.is_absolute() && dir.is_dir());
    std::env::join_paths(std::env::split_paths(&path).chain(extra)).unwrap_or(path)
}

/// The Node that installed an npm script: in the launcher's folder, or the `bin` folder
/// beside the global `lib/node_modules` (nvm, Homebrew, fnm).
pub(crate) fn node_beside(script: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    let mut dirs: Vec<PathBuf> = script.parent().into_iter().map(Path::to_path_buf).collect();
    if let Some(modules) = script.ancestors().find(|dir| dir.ends_with("node_modules")) {
        if let Some(prefix) = modules.parent() {
            dirs.push(prefix.to_path_buf());
            if prefix.ends_with("lib") {
                dirs.extend(prefix.parent().map(|root| root.join("bin")));
            }
        }
    }
    dirs.into_iter()
        .map(|dir| dir.join(name))
        .find(|node| node.is_file())
}

/// A program on `search_path`.
pub(crate) fn find(name: &str) -> Option<PathBuf> {
    which::which_in(name, Some(search_path()), std::env::temp_dir()).ok()
}

pub(crate) fn is_launcher(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    ["cmd", "bat", "ps1"]
        .iter()
        .any(|value| extension.eq_ignore_ascii_case(value))
}

/// The npm entry script a package-manager launcher runs: beside it (npm, nvm) or at the
/// relative path written in it (pnpm). The launcher is read as text, never evaluated.
pub(crate) fn launcher_script(launcher: &Path, entries: &[&str]) -> Option<PathBuf> {
    let dir = launcher.parent()?;
    if let Some(script) = entries
        .iter()
        .map(|entry| dir.join(entry))
        .find(|p| p.is_file())
    {
        return Some(script);
    }
    let mut text = String::new();
    std::fs::File::open(launcher)
        .ok()?
        .take(64_000)
        .read_to_string(&mut text)
        .ok()?;
    // npm's `.bin` shims write `..\@scope\pkg\…`, so the text need not name node_modules;
    // the resolved script must still be inside one.
    let tails: Vec<String> = entries
        .iter()
        .map(|entry| entry.trim_start_matches("node_modules").to_lowercase())
        .collect();
    // Quoted text is one path even with spaces; unquoted text splits at separators.
    let tokens = text.split('"').enumerate().flat_map(|(at, part)| {
        if at % 2 == 1 {
            vec![part]
        } else {
            part.split(|c: char| c.is_whitespace() || matches!(c, '\'' | ';' | '='))
                .collect()
        }
    });
    tokens
        .map(|token| token.trim().replace('\\', "/"))
        .filter(|token| {
            tails
                .iter()
                .any(|tail| token.to_lowercase().ends_with(tail.as_str()))
        })
        .find_map(|token| {
            let relative = ["%~dp0", "%dp0%", "${basedir}", "$basedir", "$PSScriptRoot"]
                .iter()
                .find_map(|prefix| token.strip_prefix(prefix));
            let script = match relative {
                Some(rest) => dir.join(rest.trim_start_matches('/')),
                None => PathBuf::from(&token),
            };
            let in_package = script
                .components()
                .any(|part| part.as_os_str() == "node_modules");
            (script.is_absolute() && in_package && script.is_file()).then_some(script)
        })
}

pub(crate) fn is_node_entry(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if ["js", "mjs", "cjs"]
        .iter()
        .any(|value| extension.eq_ignore_ascii_case(value))
    {
        return true;
    }
    if !extension.is_empty() {
        return false;
    }
    let mut header = [0; 128];
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let Ok(size) = file.read(&mut header) else {
        return false;
    };
    let text = String::from_utf8_lossy(&header[..size]);
    let line = text.lines().next().unwrap_or_default().trim_end();
    matches!(
        line,
        "#!/usr/bin/env node" | "#!/usr/bin/node" | "#!/usr/local/bin/node"
    )
}

pub(crate) fn normalize(value: &str) -> Result<String, String> {
    if value.chars().any(|c| matches!(c, '\0' | '\n' | '\r')) {
        return Err("Paths must not contain NUL or line breaks.".into());
    }
    let value = value.trim();
    let first = value.chars().next();
    let last = value.chars().last();
    if matches!(first, Some('\'' | '"')) {
        if value.len() < 2 || first != last {
            return Err("Remove incomplete quotes around the path.".into());
        }
        return Ok(value[1..value.len() - 1].into());
    }
    Ok(value.into())
}
