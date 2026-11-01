//! `cairngorm` terminal command: prints help and the version, and opens the app with a
//! request. A running Cairngorm receives it through its single-instance handoff.
mod args;

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

const VERSION: &str = env!("CAIRNGORM_VERSION");

fn main() -> ExitCode {
    let request = match args::parse(std::env::args().skip(1)) {
        Ok(args::Parsed::Help) => {
            print!("{}", args::help(VERSION));
            return ExitCode::SUCCESS;
        }
        Ok(args::Parsed::Version) => {
            println!("cairngorm {VERSION}");
            return ExitCode::SUCCESS;
        }
        Ok(args::Parsed::Open(request)) => request,
        Err(error) => {
            eprintln!("cairngorm: {error}");
            return ExitCode::from(2);
        }
    };
    match open(request) {
        Ok(message) => {
            println!("{message}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("cairngorm: {error}");
            ExitCode::FAILURE
        }
    }
}

fn open(request: args::Request) -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Cannot read this folder: {e}"))?;
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let request = request.resolve(&cwd, home.as_deref())?;
    let mut command = launcher(&app_path()?, &request.to_args());
    command
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
        .spawn()
        .map_err(|e| format!("Cannot start Cairngorm: {e}"))?;
    Ok(match &request.path {
        Some(path) => format!("Opening {} in Cairngorm", path.display()),
        None if request.is_empty() => "Bringing Cairngorm to the front".to_string(),
        None => "Opening Cairngorm".to_string(),
    })
}

/// Starts the app detached from this terminal, so closing it leaves Cairngorm running.
fn launcher(app: &Path, args: &[String]) -> Command {
    // macOS: `open -n` starts the bundle as a normal app; a running one takes the request.
    #[cfg(target_os = "macos")]
    if let Some(bundle) = app
        .ancestors()
        .find(|dir| dir.extension().is_some_and(|e| e == "app"))
    {
        let mut command = Command::new("/usr/bin/open");
        command.arg("-n").arg(bundle).arg("--args").args(args);
        return command;
    }
    let mut command = Command::new(app);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group: Ctrl+C in this terminal does not reach the app.
        command.process_group(0);
    }
    command
}

/// The installed app: `<install>\cairngorm.exe` above `<install>\bin\cairngorm.exe` on
/// Windows, or `Cairngorm.app/Contents/MacOS/cairngorm` beside this command on macOS.
/// CAIRNGORM_APP points the command at another build, such as a development one.
fn app_path() -> Result<PathBuf, String> {
    if let Some(app) = std::env::var_os("CAIRNGORM_APP") {
        return Ok(PathBuf::from(app));
    }
    let name = if cfg!(windows) {
        "cairngorm.exe"
    } else {
        "cairngorm"
    };
    // A command linked into another folder (/usr/local/bin) still finds its app.
    let exe = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|e| format!("Cannot find this command's folder: {e}"))?;
    let dir = exe.parent().unwrap_or(Path::new("."));
    [dir.parent().map(|up| up.join(name)), Some(dir.join(name))]
        .into_iter()
        .flatten()
        .find(|app| app.is_file() && *app != exe)
        .ok_or_else(|| "Cairngorm is not installed beside this command. Reinstall it.".into())
}
