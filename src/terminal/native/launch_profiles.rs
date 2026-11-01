use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellHost {
    pub path: String,
    pub args: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchProfile {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
    pub shell: Option<ShellHost>,
}

const WINDOWS_BASH: &str = "program=$1; shift; trap : INT; MSYS2_ARG_CONV_EXCL='*' \"$program\" \"$@\"; trap - INT; exec \"$0\" --login -i";
const UNIX_BASH: &str =
    "program=$1; shift; trap : INT; \"$program\" \"$@\"; trap - INT; exec \"$0\"";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTerminalLaunch {
    pub shell_path: String,
    pub shell_args: Vec<String>,
}

pub(crate) fn resolve(profile: LaunchProfile) -> Result<ResolvedTerminalLaunch, String> {
    if profile.name.trim().is_empty()
        || profile.name.len() > 128
        || profile.args.len() > 256
        || profile
            .args
            .iter()
            .any(|arg| arg.contains('\0') || arg.len() > 16_384)
    {
        return Err("Use a profile name and at most 256 valid literal arguments.".into());
    }
    let program = crate::cli_paths::normalize(&profile.program)?;
    let path = if std::path::Path::new(&program).is_absolute() {
        std::path::PathBuf::from(program)
    } else {
        crate::cli_catalog::find_program(&program)
            .ok_or("CLI executable not found. Check the profile path.")?
    };
    let path = crate::cli_catalog::resolve_program(&path)?;
    let mut runtime = crate::ai_runtime::AiRuntime {
        binary_path: path.to_string_lossy().into_owned(),
        home_path: String::new(),
    };
    runtime.validate("codex")?;
    let command = crate::ai_cli::command(&path)?;
    let program = command.get_program().to_string_lossy().into_owned();
    let mut args: Vec<String> = command
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    args.extend(profile.args);
    let Some(host) = profile.shell else {
        return Ok(ResolvedTerminalLaunch {
            shell_path: program,
            shell_args: args,
        });
    };
    let shell = std::path::PathBuf::from(crate::cli_paths::normalize(&host.path)?);
    if !shell.is_file() || host.args.iter().any(|arg| arg.contains('\0')) {
        return Err("The selected shell is no longer installed.".into());
    }
    let stem = shell
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut shell_args = host.args;
    if cfg!(windows) && matches!(stem.as_str(), "powershell" | "pwsh") {
        shell_args.extend([
            "-NoLogo".into(),
            "-NoExit".into(),
            "-EncodedCommand".into(),
            encoded_script(&program, &args)?,
        ]);
    } else if matches!(stem.as_str(), "bash" | "zsh" | "sh") && (!cfg!(windows) || git_bash(&shell))
    {
        // Ctrl+C in the CLI must not end the shell before it re-opens. On Windows the
        // arguments reach the CLI unconverted, and the shell left open is a login shell again,
        // as when Git Bash is opened on its own.
        let script = if cfg!(windows) {
            WINDOWS_BASH
        } else {
            UNIX_BASH
        };
        shell_args.extend([
            "-c".into(),
            script.into(),
            shell.to_string_lossy().into_owned(),
            program,
        ]);
        shell_args.extend(args);
    } else {
        return Err("Unsupported profile host. Choose Direct, PowerShell, bash, zsh or sh for this platform.".into());
    }
    Ok(ResolvedTerminalLaunch {
        shell_path: shell.to_string_lossy().into_owned(),
        shell_args,
    })
}

/// The CLI a resolved profile runs, read back from its own launch encoding.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProfileCli {
    pub program: String,
    pub args: Vec<String>,
}

fn encoded_script(program: &str, args: &[String]) -> Result<String, String> {
    let payload = STANDARD.encode(
        serde_json::to_vec(&serde_json::json!({"program":program,"args":args}))
            .map_err(|e| e.to_string())?,
    );
    let script = include_str!("../assets/launch-cli.ps1").replace("__PAYLOAD__", &payload);
    let utf16: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    Ok(STANDARD.encode(utf16))
}

fn decoded_cli(encoded: &str) -> Option<ProfileCli> {
    let bytes = STANDARD.decode(encoded).ok()?;
    if bytes.len() % 2 != 0 {
        return None;
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    let script = String::from_utf16(&units).ok()?;
    let (_, rest) = script.split_once("FromBase64String('")?;
    let (payload, _) = rest.split_once('\'')?;
    // Only rewrite our own wrapper, never an arbitrary user script containing the same marker.
    let expected = include_str!("../assets/launch-cli.ps1").replace("__PAYLOAD__", payload);
    if script.replace("\r\n", "\n") != expected.replace("\r\n", "\n") {
        return None;
    }
    serde_json::from_slice(&STANDARD.decode(payload).ok()?).ok()
}

fn encoded_index(args: &[String]) -> Option<usize> {
    args.iter()
        .position(|arg| arg.eq_ignore_ascii_case("-EncodedCommand"))
}

fn bash_index(args: &[String]) -> Option<usize> {
    let i = args.iter().position(|arg| arg == "-c")?;
    [WINDOWS_BASH, UNIX_BASH]
        .contains(&args.get(i + 1)?.as_str())
        .then_some(i)
}

/// Reads the CLI behind a persisted launch: a PowerShell/bash profile host or a direct program.
/// Any other explicit shell command is not a profile and returns None.
pub(crate) fn profile_cli(shell: &str, args: &[String]) -> Option<ProfileCli> {
    if let Some(i) = encoded_index(args) {
        return decoded_cli(args.get(i + 1)?);
    }
    if let Some(i) = bash_index(args) {
        return Some(ProfileCli {
            program: args.get(i + 3)?.clone(),
            args: args.get(i + 4..)?.to_vec(),
        });
    }
    if args.iter().any(|arg| arg == "-c") {
        return None;
    }
    Some(ProfileCli {
        program: shell.to_string(),
        args: args.to_vec(),
    })
}

/// The shell arguments before our CLI wrapper; arbitrary explicit commands are not profiles.
pub(crate) fn host_args(shell: &str, args: &[String]) -> Option<Vec<String>> {
    profile_cli(shell, args)?;
    let index = encoded_index(args).or_else(|| bash_index(args))?;
    Some(args[..index].to_vec())
}

/// Rebuilds a profile with the current CLI arguments, keeping its executable and host.
pub(crate) fn with_cli_args(
    shell: &str,
    args: &[String],
    current: &[String],
) -> Option<Vec<String>> {
    let mut cli = profile_cli(shell, args)?;
    cli.args = current.to_vec();
    if let Some(i) = encoded_index(args) {
        let mut out = args[..=i].to_vec();
        out.push(encoded_script(&cli.program, &cli.args).ok()?);
        out.extend_from_slice(args.get(i + 2..)?);
        return Some(out);
    }
    if let Some(i) = bash_index(args) {
        let mut out = args[..i + 4].to_vec();
        out.extend(cli.args);
        return Some(out);
    }
    Some(cli.args)
}

/// Git for Windows' bash, not WSL's System32 bash.exe, which cannot run Windows paths.
fn git_bash(shell: &std::path::Path) -> bool {
    shell
        .components()
        .any(|part| part.as_os_str().eq_ignore_ascii_case("git"))
}

#[tauri::command(async)]
pub fn resolve_terminal_profile(profile: LaunchProfile) -> Result<ResolvedTerminalLaunch, String> {
    resolve(profile)
}

#[cfg(test)]
#[path = "../../../tests/native/cli-launch-profiles.rs"]
mod tests;
