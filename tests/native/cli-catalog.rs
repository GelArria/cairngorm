use super::*;

#[test]
fn catalog_deduplicates_programs_without_merging_different_paths() {
    let entry = |id: &str, program: &str| DetectedCli {
        id: id.into(),
        name: id.into(),
        program: program.into(),
    };
    let entries = vec![
        entry("first", "C:/CLI Tools/agent.exe"),
        entry("alias", "C:/CLI Tools/agent.exe"),
        entry("other", "C:/CLI Tools/other.exe"),
    ];
    let unique = unique_programs(entries.into_iter());
    assert_eq!(
        unique
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        ["first", "other"]
    );
    #[cfg(windows)]
    assert_eq!(
        unique_programs(
            vec![
                entry("first", "C:/CLI Tools/agent.exe"),
                entry("alias", "c:/cli tools/AGENT.EXE")
            ]
            .into_iter()
        )
        .len(),
        1
    );
}

#[test]
fn cli_scan_only_lists_runnable_presence_without_executing_the_program() {
    const CHILD: &str = "CAIRNGORM_CLI_SCAN_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let entries = detect_agent_clis();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, "pi");
        assert!(entries[0].program.contains("CLI Tools With Spaces"));
        return;
    }
    let dir = std::env::temp_dir().join(format!("CLI Tools With Spaces {}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    std::fs::copy(
        std::env::current_exe().unwrap(),
        dir.join(format!("pi{suffix}")),
    )
    .unwrap();
    std::fs::create_dir(dir.join(format!("gemini{suffix}"))).unwrap();
    std::fs::write(dir.join(format!("qwen{suffix}")), "not executable").unwrap();
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "cli_catalog::tests::cli_scan_only_lists_runnable_presence_without_executing_the_program", "--nocapture"])
        .env(CHILD, "1").env("PATH", &dir).env("HOME", &dir).env("USERPROFILE", &dir).env("APPDATA", &dir)
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
fn npm_bins_resolve_in_spaced_paths_without_running_wrappers_or_escaping_packages() {
    let dir =
        std::env::temp_dir().join(format!("CLI Catalog With Spaces {}", uuid::Uuid::new_v4()));
    let root = dir.join("node_modules/@earendil-works/pi-coding-agent");
    std::fs::create_dir_all(root.join("dist")).unwrap();
    let wrapper = dir.join("pi.cmd");
    std::fs::write(&wrapper, "do not execute this wrapper").unwrap();
    for entry in ["dist/cli.js", "dist/cli.cjs", "dist/cli.mjs", "dist/cli"] {
        std::fs::write(
            root.join("package.json"),
            serde_json::json!({"bin":{"pi":entry}}).to_string(),
        )
        .unwrap();
        let target = root.join(entry);
        std::fs::write(&target, "#!/usr/bin/env node\nconsole.log('fixture')").unwrap();
        let resolved = resolve_program(&wrapper).unwrap();
        assert_eq!(resolved, target.canonicalize().unwrap());
        let mut runtime = crate::ai_runtime::AiRuntime {
            binary_path: resolved.to_string_lossy().into_owned(),
            home_path: String::new(),
        };
        runtime.validate("codex").unwrap();
        let command = crate::ai_cli::command(&resolved).unwrap();
        assert_eq!(
            command.get_program(),
            which::which("node").unwrap().as_os_str()
        );
        assert_eq!(
            std::path::Path::new(command.get_args().next().unwrap())
                .canonicalize()
                .unwrap(),
            resolved
        );
    }
    std::fs::write(dir.join("outside.js"), "").unwrap();
    std::fs::write(
        root.join("package.json"),
        r#"{"bin":{"pi":"../../../outside.js"}}"#,
    )
    .unwrap();
    assert!(resolve_program(&wrapper).unwrap_err().contains("escapes"));
    assert!(resolve_program(&dir.join("unknown.cmd"))
        .unwrap_err()
        .contains("actual executable"));
    std::fs::remove_dir_all(dir).unwrap();
}
