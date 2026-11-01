use std::collections::BTreeMap;
use std::path::Path;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedShell {
    name: String,
    path: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    is_default: bool,
}

pub(crate) fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "C:\\".to_string())
}

/// Search PATH without launching a console process.
fn find_on_path(name: &str) -> Option<String> {
    which::which(name)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Search all PATH matches so WSL's bash.exe cannot mask Git Bash.
fn find_on_path_filtered(name: &str, filter: &str) -> Option<String> {
    which::which_all(name)
        .ok()?
        .find(|p| p.to_string_lossy().to_lowercase().contains(filter))
        .map(|p| p.to_string_lossy().into_owned())
}

/// Check if a path exists on disk
fn exists_at(path: &str) -> Option<String> {
    if Path::new(path).exists() {
        Some(path.to_string())
    } else {
        None
    }
}

/// Inherit critical env vars from the current process so spawned shells
/// have PATH, SystemRoot, etc. Without this, pty replaces the entire env
/// and Git Bash / other shells fail to start (can't find commands).
fn inherit_env() -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();
    let keys: &[&str] = if cfg!(windows) {
        &[
            "PATH",
            "SystemRoot",
            "USERPROFILE",
            "HOME",
            "TERM",
            "TEMP",
            "TMP",
            "PROGRAMFILES",
            "PROGRAMFILES(X86)",
            "PROGRAMDATA",
            "COMPUTERNAME",
            "USERNAME",
            "PATHEXT",
            "COMSPEC",
            "DRIVERDATA",
            "HOMEDRIVE",
            "HOMEPATH",
            "ALLUSERSPROFILE",
            "OS",
            "PROCESSOR_ARCHITECTURE",
        ]
    } else {
        &[
            "PATH",
            "HOME",
            "TERM",
            "USER",
            "SHELL",
            "LANG",
            "XDG_CONFIG_HOME",
        ]
    };
    for key in keys {
        if let Ok(val) = std::env::var(key) {
            env.insert(key.to_string(), val);
        }
    }
    env
}

fn add_shell(
    shells: &mut Vec<DetectedShell>,
    name: &str,
    path: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
) {
    // Different WSL distributions share a program, but not their argument arrays.
    let same_path = |other: &str| {
        if cfg!(windows) {
            other.eq_ignore_ascii_case(&path)
        } else {
            other == path
        }
    };
    if shells.iter().any(|s| same_path(&s.path) && s.args == args) {
        return;
    }
    shells.push(DetectedShell {
        name: name.to_string(),
        path,
        args,
        env,
        is_default: false,
    });
}

#[tauri::command(async)]
pub fn detect_shells() -> Vec<DetectedShell> {
    let mut shells: Vec<DetectedShell> = Vec::new();
    let home = home_dir();
    let base_env = inherit_env();

    if cfg!(windows) {
        let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());

        // PowerShell 5 (built-in)
        let ps_path = format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sys);
        if let Some(p) = find_on_path("powershell.exe").or_else(|| exists_at(&ps_path)) {
            let mut env = base_env.clone();
            env.insert("TERM".to_string(), "xterm-256color".to_string());
            add_shell(&mut shells, "PowerShell", p, vec![], env);
        }

        // PowerShell 7 (pwsh) — installed in Program Files, NOT System32
        if let Some(p) = find_on_path("pwsh.exe")
            .or_else(|| exists_at("C:\\Program Files\\PowerShell\\7\\pwsh.exe"))
            .or_else(|| exists_at("C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe"))
        {
            let mut env = base_env.clone();
            env.insert("TERM".to_string(), "xterm-256color".to_string());
            add_shell(&mut shells, "PowerShell 7", p, vec![], env);
        }

        // CMD
        let cmd_path = format!("{}\\System32\\cmd.exe", sys);
        if let Some(p) = find_on_path("cmd.exe").or_else(|| exists_at(&cmd_path)) {
            let mut env = base_env.clone();
            env.insert("TERM".to_string(), "xterm-256color".to_string());
            add_shell(&mut shells, "Command Prompt", p, vec![], env);
        }

        // Git Bash — check known Git install paths first (avoids WSL's bash.exe),
        // then search PATH filtering for "git" in the path
        let git_bash_path = exists_at("C:\\Program Files\\Git\\bin\\bash.exe")
            .or_else(|| exists_at("C:\\Program Files (x86)\\Git\\bin\\bash.exe"))
            .or_else(|| {
                let scoop = format!("{}\\scoop\\apps\\git\\current\\bin\\bash.exe", home);
                exists_at(&scoop)
            })
            .or_else(|| find_on_path_filtered("bash.exe", "git"));
        if let Some(p) = git_bash_path {
            let mut env = base_env.clone();
            env.insert("HOME".to_string(), home.clone());
            env.insert("TERM".to_string(), "xterm-256color".to_string());
            env.insert("MSYS".to_string(), "enable_pcon".to_string()); // ConPTY compat for MSYS2 bash
                                                                       // Spawn bash directly — MSYS=enable_pcon for ConPTY compatibility.
                                                                       // --norc --noprofile to avoid /etc/profile hang under ConPTY.
            add_shell(
                &mut shells,
                "Git Bash",
                p,
                vec!["--login".to_string(), "-i".to_string()],
                env,
            );
        }

        // NuShell
        if let Some(p) = find_on_path("nu.exe") {
            let mut env = base_env.clone();
            env.insert("TERM".to_string(), "xterm-256color".to_string());
            add_shell(&mut shells, "Nushell", p, vec![], env);
        }

        // WSL detection
        let wsl_path = format!("{}\\System32\\wsl.exe", sys);
        if exists_at(&wsl_path).is_some() || find_on_path("wsl.exe").is_some() {
            let resolved_wsl = find_on_path("wsl.exe").unwrap_or(wsl_path.clone());
            let mut command = std::process::Command::new(&resolved_wsl);
            command.args(["--list", "--quiet"]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW, like background git calls
            }
            if let Ok(output) = command.output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let distro = line
                        .trim()
                        .replace('\0', "")
                        .trim_end_matches('\r')
                        .to_string();
                    if !distro.is_empty() {
                        let mut env = base_env.clone();
                        env.insert("TERM".to_string(), "xterm-256color".to_string());
                        add_shell(
                            &mut shells,
                            &format!("WSL: {}", distro),
                            resolved_wsl.clone(),
                            vec!["-d".to_string(), distro.clone()],
                            env,
                        );
                    }
                }
            }
        }
    } else {
        // macOS / Linux
        let mut login_env = base_env.clone();
        login_env.insert("TERM".to_string(), "xterm-256color".to_string());

        let candidates: Vec<(&str, &str, Vec<String>)> = vec![
            ("/bin/zsh", "Zsh", vec!["-l".to_string()]),
            ("/bin/bash", "Bash", vec!["-l".to_string()]),
            ("/usr/bin/fish", "Fish", vec![]),
            ("/bin/sh", "Sh", vec![]),
        ];
        for (p, n, a) in candidates {
            if exists_at(p).is_some() {
                add_shell(&mut shells, n, p.to_string(), a, login_env.clone());
            }
        }
    }

    if let Some(first) = shells.first_mut() {
        first.is_default = true;
    }
    shells
}

#[tauri::command(async)]
pub fn detect_home() -> String {
    home_dir()
}
