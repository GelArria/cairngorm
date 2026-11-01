use crate::ai_runtime::AiRuntime;

#[test]
fn runtime_validates_paths_without_evaluating_shell_commands() {
    let dir = std::env::temp_dir().join(format!("cairngorm-runtime-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let binary = dir.join("official cli.js");
    std::fs::write(&binary, "console.log('stub')").unwrap();
    let mut runtime = AiRuntime {
        binary_path: format!(" {} ", binary.display()),
        home_path: format!(" {} ", dir.display()),
    };
    runtime.validate("codex").unwrap();
    assert_eq!(runtime.resolve("codex").unwrap().unwrap(), binary);
    assert_eq!(runtime.config_home("codex").unwrap(), dir);
    runtime.binary_path = format!("\"{}\"", binary.display());
    runtime.home_path = format!("'{}'", dir.display());
    runtime.validate("codex").unwrap();
    assert_eq!(runtime.resolve("codex").unwrap().unwrap(), binary);
    assert_eq!(runtime.config_home("codex").unwrap(), dir);
    assert!(runtime.validate("unknown").is_err());
    let not_executable = dir.join("not-a-cli.txt");
    std::fs::write(&not_executable, "not executable").unwrap();
    let mut invalid = AiRuntime {
        binary_path: not_executable.to_string_lossy().into_owned(),
        home_path: String::new(),
    };
    assert!(invalid.validate("codex").is_err());
    let mut native = AiRuntime {
        binary_path: std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        home_path: String::new(),
    };
    native.validate("claude").unwrap();
    let uppercase = dir.join("uppercase cli.JS");
    std::fs::copy(&binary, &uppercase).unwrap();
    let command = crate::ai_cli::command(&uppercase).unwrap();
    assert_eq!(command.get_args().next(), Some(uppercase.as_os_str()));
    for input in [
        "codex; evil",
        "codex --dangerously-bypass",
        "$(evil)",
        "../codex",
        "\"unclosed path",
        "codex\n",
    ] {
        let runtime = AiRuntime {
            binary_path: input.into(),
            home_path: String::new(),
        };
        assert!(runtime.resolve("codex").is_err());
    }
    let mut runtime = AiRuntime {
        binary_path: String::new(),
        home_path: "relative-folder".into(),
    };
    assert!(runtime.validate("claude").is_err());
    runtime.home_path = dir.join("missing").to_string_lossy().into_owned();
    assert!(runtime.validate("claude").is_err());
    runtime.home_path = "~/.codex".into();
    assert_eq!(
        runtime.config_home("codex").unwrap(),
        crate::ai_cli::home().join(".codex")
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn npm_runtime_wrappers_keep_spaced_paths_and_fail_when_node_is_missing() {
    const CHILD: &str = "CAIRNGORM_RUNTIME_WITHOUT_NODE";
    if std::env::var_os(CHILD).is_some() {
        let path = std::env::var_os("CAIRNGORM_RUNTIME_FIXTURE").unwrap();
        let runtime = AiRuntime {
            binary_path: std::path::PathBuf::from(path)
                .to_string_lossy()
                .into_owned(),
            home_path: String::new(),
        };
        // System folders such as /opt/homebrew/bin cannot be hidden from the child.
        if !cfg!(windows) && crate::cli_paths::find("node").is_some() {
            eprintln!("skipped: a system Node is installed");
            return;
        }
        assert!(runtime
            .resolve("claude")
            .unwrap_err()
            .contains("Node.js is required"));
        return;
    }
    let dir = std::env::temp_dir().join(format!(
        "User With Spaces Ω CLI Tools {}",
        uuid::Uuid::new_v4()
    ));
    let package = dir.join("node_modules/@anthropic-ai/claude-code");
    std::fs::create_dir_all(&package).unwrap();
    let entry = package.join("cli.js");
    std::fs::write(&entry, "console.log('fixture')").unwrap();
    for suffix in ["cmd", "ps1"] {
        let wrapper = dir.join(format!("claude.{suffix}"));
        std::fs::write(&wrapper, "This wrapper must never be evaluated").unwrap();
        let runtime = AiRuntime {
            binary_path: format!("\"{}\"", wrapper.display()),
            home_path: String::new(),
        };
        assert_eq!(runtime.resolve("claude").unwrap().unwrap(), entry);
    }
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "ai_runtime_tests::npm_runtime_wrappers_keep_spaced_paths_and_fail_when_node_is_missing", "--nocapture"])
        .env(CHILD, "1").env("CAIRNGORM_RUNTIME_FIXTURE", dir.join("claude.cmd"))
        .env("PATH", "").env("USERPROFILE", &dir).env("HOME", &dir)
        // Well-known install folders are searched too: hide them as well.
        .env_remove("APPDATA").env_remove("LOCALAPPDATA").env_remove("NVM_SYMLINK")
        .current_dir(&dir).output().unwrap();
    std::fs::remove_dir_all(dir).unwrap();
    assert!(
        child.status.success(),
        "{}{}",
        String::from_utf8_lossy(&child.stdout),
        String::from_utf8_lossy(&child.stderr)
    );
    assert!(String::from_utf8_lossy(&child.stdout).contains("1 passed"));
}

#[test]
fn legacy_settings_keep_automatic_runtime_defaults() {
    let runtime: AiRuntime = serde_json::from_str("{}").unwrap();
    assert_eq!(runtime.binary_path, "");
    assert_eq!(runtime.home_path, "");
    assert_eq!(crate::ai_runtime::env_name("codex"), "CODEX_HOME");
    assert_eq!(crate::ai_runtime::env_name("claude"), "CLAUDE_CONFIG_DIR");
}

#[test]
fn pnpm_launchers_resolve_to_the_script_they_name_without_running_it() {
    let dir = std::env::temp_dir().join(format!("cairngorm-pnpm-{}", uuid::Uuid::new_v4()));
    let package = dir.join("global/5/node_modules/@openai/codex/bin");
    std::fs::create_dir_all(&package).unwrap();
    let entry = package.join("codex.js");
    std::fs::write(&entry, "console.log('fixture')").unwrap();
    let launcher = dir.join("codex.CMD");
    std::fs::write(
        &launcher,
        concat!(
            "@SETLOCAL\r\n",
            r#"@SET "NODE_PATH=C:\elsewhere\node_modules""#,
            "\r\n",
            r#"node "%~dp0\global\5\node_modules\@openai\codex\bin\codex.js" %*"#,
            "\r\n",
        ),
    )
    .unwrap();
    let runtime = AiRuntime {
        binary_path: launcher.to_string_lossy().into_owned(),
        home_path: String::new(),
    };
    assert_eq!(runtime.resolve("codex").unwrap().unwrap(), entry);
    // A launcher that names no known entry is still rejected.
    std::fs::write(&launcher, r#"node "%~dp0\other.js" %*"#).unwrap();
    assert!(runtime.resolve("codex").is_err());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn nvm_versions_are_searched_newest_first() {
    let dir = std::env::temp_dir().join(format!("cairngorm-nvm-{}", uuid::Uuid::new_v4()));
    for version in ["v9.11.2", "v20.11.0", "v18.19.1"] {
        std::fs::create_dir_all(dir.join(version)).unwrap();
    }
    let bins = crate::cli_paths::nvm_bins(&dir);
    let names: Vec<_> = bins
        .iter()
        .map(|b| b.parent().unwrap().file_name().unwrap().to_owned())
        .collect();
    assert_eq!(names, ["v20.11.0", "v18.19.1", "v9.11.2"]);
    assert!(bins.iter().all(|b| b.ends_with("bin")));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_node_that_installed_a_script_is_preferred() {
    let dir = std::env::temp_dir().join(format!("cairngorm-node-{}", uuid::Uuid::new_v4()));
    let node = if cfg!(windows) { "node.exe" } else { "node" };
    let script = dir.join("lib/node_modules/@openai/codex/bin/codex.js");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::create_dir_all(dir.join("bin")).unwrap();
    std::fs::write(&script, "").unwrap();
    assert_eq!(crate::cli_paths::node_beside(&script), None);
    std::fs::write(dir.join("bin").join(node), "").unwrap();
    assert_eq!(
        crate::cli_paths::node_beside(&script),
        Some(dir.join("bin").join(node))
    );
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn launchers_with_spaces_anywhere_in_their_paths_resolve() {
    use crate::cli_paths::launcher_script;
    let entries = crate::ai_cli::npm_entries("codex");
    let dir = std::env::temp_dir().join(format!("John Doe Ω pnpm {}", uuid::Uuid::new_v4()));
    let tail = "node_modules/@openai/codex/bin/codex.js";
    let script = dir.join("global store/5").join(tail);
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "").unwrap();
    let write = |name: &str, text: String| {
        let launcher = dir.join(name);
        std::fs::write(&launcher, text).unwrap();
        launcher
    };
    let same = |found: Option<std::path::PathBuf>| found.map(|p| std::fs::canonicalize(p).unwrap());
    let expected = Some(std::fs::canonicalize(&script).unwrap());
    let windows_tail = r"global store\5\node_modules\@openai\codex\bin\codex.js";

    // pnpm .cmd: a relative path with spaces after %~dp0.
    let cmd = write(
        "codex.cmd",
        format!("@SETLOCAL\r\nnode \"%~dp0\\{windows_tail}\" %*\r\n"),
    );
    assert_eq!(same(launcher_script(&cmd, entries)), expected, "cmd");
    // An absolute path with spaces.
    let absolute = write("abs.cmd", format!("node \"{}\" %*", script.display()));
    assert_eq!(
        same(launcher_script(&absolute, entries)),
        expected,
        "absolute"
    );
    // pnpm .ps1 and POSIX sh launchers.
    let ps1 = write(
        "codex.ps1",
        "& node \"$basedir/global store/5/node_modules/@openai/codex/bin/codex.js\" $args".into(),
    );
    assert_eq!(same(launcher_script(&ps1, entries)), expected, "ps1");
    let sh = write("codex", "#!/bin/sh\nexec node  \"$basedir/global store/5/node_modules/@openai/codex/bin/codex.js\" \"$@\"\n".into());
    assert_eq!(same(launcher_script(&sh, entries)), expected, "sh");
    // npm's node_modules/.bin shim reaches the package through `..`.
    let bin = dir.join("global store/5/node_modules/.bin");
    std::fs::create_dir_all(&bin).unwrap();
    let shim = bin.join("codex.cmd");
    std::fs::write(&shim, r#""%dp0%\..\@openai\codex\bin\codex.js" %*"#).unwrap();
    assert_eq!(same(launcher_script(&shim, entries)), expected, "shim");
    // A relative path without a launcher prefix, or outside node_modules, is ignored.
    let relative = write(
        "rel.cmd",
        format!("node {}", "global/5/".to_string() + tail),
    );
    assert!(launcher_script(&relative, entries).is_none());
    let stray = dir.join("@openai/codex/bin/codex.js");
    std::fs::create_dir_all(stray.parent().unwrap()).unwrap();
    std::fs::write(&stray, "").unwrap();
    let outside = write(
        "out.cmd",
        "node \"%~dp0\\@openai\\codex\\bin\\codex.js\"".into(),
    );
    assert!(launcher_script(&outside, entries).is_none());

    // The same launcher chosen in Settings, quoted as Explorer copies it.
    let runtime = AiRuntime {
        binary_path: format!("\"{}\"", cmd.display()),
        home_path: String::new(),
    };
    assert_eq!(same(runtime.resolve("codex").unwrap()), expected);
    std::fs::remove_dir_all(dir).unwrap();
}
