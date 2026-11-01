use super::*;

fn profile(program: String) -> LaunchProfile {
    LaunchProfile {
        id: "fixture".into(),
        name: "Echo".into(),
        program,
        args: vec![],
        shell: None,
    }
}

#[test]
fn profile_arguments_are_literal_in_direct_and_powershell_hosts() {
    let dir = std::env::temp_dir().join(format!("CLI Tools With Spaces {}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let script = dir.join("argv echo.js");
    std::fs::write(
        &script,
        "console.log(JSON.stringify(process.argv.slice(2)))",
    )
    .unwrap();
    let package = dir.join("node_modules/@earendil-works/pi-coding-agent");
    std::fs::create_dir_all(package.join("dist")).unwrap();
    std::fs::copy(&script, package.join("dist/cli.js")).unwrap();
    std::fs::write(
        package.join("package.json"),
        r#"{"bin":{"pi":"dist/cli.js"}}"#,
    )
    .unwrap();
    let wrapper = dir.join("pi.cmd");
    let marker = dir.join("second-command.txt");
    std::fs::write(&wrapper, format!("echo unsafe > \"{}\"", marker.display())).unwrap();
    let mut p = profile(script.to_string_lossy().into_owned());
    p.args = [
        "one argument",
        "",
        "a'\"&$b",
        "Unicode Ω",
        "a\\\"b",
        "trailing\\",
        "%PATH%!x!",
        "; exit 17",
    ]
    .map(String::from)
    .to_vec();
    let run = |p: LaunchProfile| {
        let launch = resolve(p).unwrap();
        let mut command = crate::ai_cli::command(std::path::Path::new(&launch.shell_path)).unwrap();
        command.args(
            launch
                .shell_args
                .iter()
                .filter(|arg| arg.as_str() != "-NoExit"),
        );
        let (ok, out, err) =
            crate::ai_cli::run(command, None, std::time::Duration::from_secs(30)).unwrap();
        assert!(ok, "{err}");
        serde_json::from_str::<Vec<String>>(out.trim()).unwrap()
    };
    p.args.push(format!(
        "& [IO.File]::WriteAllText('{}','unsafe')",
        marker.display()
    ));
    let programs = if cfg!(windows) {
        vec![script, wrapper]
    } else {
        vec![script]
    };
    for program in programs {
        p.program = program.to_string_lossy().into_owned();
        p.shell = None;
        assert_eq!(run(p.clone()), p.args);
        #[cfg(windows)]
        for shell in ["powershell.exe", "pwsh.exe"] {
            if let Ok(path) = which::which(shell) {
                eprintln!(
                    "Literal argv proof: {} hosting {}",
                    path.display(),
                    program.display()
                );
                p.shell = Some(ShellHost {
                    path: path.to_string_lossy().into_owned(),
                    args: vec![],
                });
                assert_eq!(run(p.clone()), p.args, "{shell}");
                assert!(
                    !marker.exists(),
                    "neither npm wrapper nor argv may execute another command"
                );
            } else if std::env::var_os("CAIRNGORM_REQUIRE_PWSH_TEST").is_some() {
                panic!("Required test host {shell} is missing");
            }
        }
    }
    p.program = dir.join("missing.exe").to_string_lossy().into_owned();
    assert!(resolve(p).is_err());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn profile_shell_wrappers_are_never_evaluated() {
    let dir = std::env::temp_dir().join(format!("cairngorm-wrapper-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("custom.cmd");
    std::fs::write(&path, "echo unsafe").unwrap();
    assert!(resolve(profile(path.to_string_lossy().into_owned()))
        .unwrap_err()
        .contains("actual executable"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(windows)]
#[test]
fn windows_bash_hosts_must_be_git_bash() {
    let git_path = std::path::Path::new(r"C:\Program Files\Git\bin\bash.exe");
    let wsl_path = std::path::Path::new(r"C:\Windows\System32\bash.exe");
    assert!(git_bash(git_path));
    assert!(!git_bash(wsl_path));
    let node = crate::cli_catalog::find_program("node").expect("node on PATH");
    let mut p = profile(node.to_string_lossy().into_owned());
    if wsl_path.is_file() {
        p.shell = Some(ShellHost {
            path: wsl_path.to_string_lossy().into(),
            args: vec![],
        });
        assert!(resolve(p.clone()).is_err());
    }
    if git_path.is_file() {
        p.shell = Some(ShellHost {
            path: git_path.to_string_lossy().into(),
            args: vec!["--login".into(), "-i".into()],
        });
        let launch = resolve(p).unwrap();
        assert!(launch
            .shell_args
            .iter()
            .any(|a| a.contains("MSYS2_ARG_CONV_EXCL")));
        assert!(launch
            .shell_args
            .iter()
            .any(|a| a.ends_with("exec \"$0\" --login -i")));
    }
}

/// The break: a host shell exits together with the agent CLI, so closing the agent leaves a
/// dead pane. Runs each installed host in a real PTY with a "CLI" that exits at once, then
/// types a command and expects the shell to answer it.
#[test]
fn the_host_shell_stays_usable_after_the_cli_exits() {
    use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
    use std::io::{Read, Write};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    let dir = std::env::temp_dir().join(format!("cairngorm-exit-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let script = dir.join("agent.js");
    std::fs::write(&script, "console.log('agent-started'); process.exit(0)").unwrap();
    let hosts: Vec<std::path::PathBuf> = if cfg!(windows) {
        ["powershell.exe", "pwsh.exe"]
            .iter()
            .filter_map(|h| which::which(h).ok())
            .chain(
                [r"C:\Program Files\Git\bin\bash.exe"]
                    .iter()
                    .map(std::path::PathBuf::from)
                    .filter(|p| p.is_file()),
            )
            .collect()
    } else {
        ["bash", "zsh", "sh"]
            .iter()
            .filter_map(|h| which::which(h).ok())
            .collect()
    };
    assert!(!hosts.is_empty());
    for host in hosts {
        let mut p = profile(script.to_string_lossy().into_owned());
        p.shell = Some(ShellHost {
            path: host.to_string_lossy().into_owned(),
            args: vec![],
        });
        let launch = resolve(p).unwrap();
        let pair = NativePtySystem::default()
            .openpty(PtySize {
                rows: 30,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new(&launch.shell_path);
        cmd.args(&launch.shell_args);
        cmd.cwd(&dir);
        for (key, value) in std::env::vars_os() {
            cmd.env(key, value);
        }
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut writer = pair.master.take_writer().unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let output = Arc::new(Mutex::new(String::new()));
        let sink = output.clone();
        std::thread::spawn(move || {
            let mut bytes = [0u8; 4096];
            while let Ok(n) = reader.read(&mut bytes) {
                if n == 0 {
                    break;
                }
                sink.lock()
                    .unwrap()
                    .push_str(&String::from_utf8_lossy(&bytes[..n]));
            }
        });
        let wait_for = |text: &str, limit: Duration| {
            let started = Instant::now();
            while started.elapsed() < limit {
                if output.lock().unwrap().contains(text) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            false
        };
        assert!(
            wait_for("agent-started", Duration::from_secs(30)),
            "{}: {}",
            host.display(),
            output.lock().unwrap()
        );
        std::thread::sleep(Duration::from_secs(2));
        // The marker only appears when the shell evaluates the arithmetic, never as an echo.
        let line =
            if host.to_string_lossy().contains("bash") || host.to_string_lossy().ends_with("sh") {
                "echo alive-$((40+2))\r"
            } else {
                "Write-Output ('alive-' + (40+2))\r"
            };
        writer.write_all(line.as_bytes()).unwrap();
        let alive = wait_for("alive-42", Duration::from_secs(20));
        let exited = child.try_wait().ok().flatten();
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            alive && exited.is_none(),
            "{}: shell gone after the CLI exited: {}",
            host.display(),
            output.lock().unwrap()
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}
