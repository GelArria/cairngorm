// Run production detection, verification and commit routing with an isolated CLI/home.
#[test]
fn existing_cli_verification_provisions_commit_drafts_without_changing_byok() {
    if std::env::var_os("CAIRNGORM_AI_TEST_CHILD").is_some() {
        let home = crate::ai_cli::home();
        let repo = home.join("repo");
        std::fs::create_dir(&repo).unwrap();
        let git = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .current_dir(&repo)
                .args(args)
                .status()
                .unwrap()
                .success())
        };
        git(&["init", "--quiet"]);
        std::fs::write(repo.join("change.txt"), "test change").unwrap();
        git(&["add", "change.txt"]);
        let byok = home.join(".panel/agent/config.json");
        std::fs::create_dir_all(byok.parent().unwrap()).unwrap();
        let config = r#"{"provider":"openai","model":"existing-model","baseUrl":"https://api.invalid/v1","apiKey":"existing-test-key"}"#;
        std::fs::write(&byok, config).unwrap();
        fn run<F: std::future::Future>(future: F) -> F::Output {
            tauri::async_runtime::block_on(future)
        }
        let view = run(crate::ai_integrations::detect_ai_services()).unwrap();
        let json = serde_json::to_value(view).unwrap();
        assert_eq!(json["services"][1]["status"], "session-detected");
        assert!(crate::ai_integrations::selected_provider()
            .unwrap()
            .is_none());
        assert!(run(crate::ai_native::get_codex_agent_env())
            .unwrap()
            .is_none());
        assert!(!run(crate::ai_native::ai_summary_setup_required()).unwrap());
        std::fs::remove_file(&byok).unwrap();
        assert!(run(crate::ai_native::ai_summary_setup_required()).unwrap());
        std::fs::write(&byok, config).unwrap();
        let cfg_path = home.join(".panel/agent/integrations.json");
        std::fs::write(
            &cfg_path,
            r#"{"setupComplete":true,"commitProvider":"claude"}"#,
        )
        .unwrap();
        assert!(crate::ai_integrations::selected_provider()
            .unwrap()
            .is_none());
        let legacy =
            serde_json::to_value(run(crate::ai_integrations::detect_ai_services()).unwrap())
                .unwrap();
        assert!(run(crate::ai_integrations::needs_ai_setup()).unwrap());
        assert!(run(crate::ai_native::ai_summary_setup_required()).unwrap());
        assert_eq!(legacy["claudeConsentRequired"], true);
        assert!(legacy["commitProvider"].is_null());
        let denied = run(crate::git_summary::git_summarize(
            repo.to_string_lossy().into_owned(),
            "staged".into(),
        ))
        .unwrap_err();
        assert!(denied.contains("consent required"));
        assert!(std::fs::read_to_string(&cfg_path)
            .unwrap()
            .contains("claude"));
        assert!(run(crate::ai_integrations::connect_ai_service(
            "claude".into(),
            None
        ))
        .is_err());
        assert!(run(crate::ai_integrations::connect_ai_service(
            "claude".into(),
            Some("i understand".into())
        ))
        .is_err());
        assert!(!home.join("calls.jsonl").exists());
        let legacy_bytes = std::fs::read(&cfg_path).unwrap();
        let key = std::env::var("ANTHROPIC_API_KEY").unwrap();
        std::env::remove_var("ANTHROPIC_API_KEY");
        assert!(run(crate::ai_integrations::connect_ai_service(
            "claude".into(),
            Some("I understand".into())
        ))
        .is_err());
        assert!(!home.join("calls.jsonl").exists());
        assert_eq!(std::fs::read(&cfg_path).unwrap(), legacy_bytes);
        std::env::set_var("ANTHROPIC_API_KEY", key);
        std::fs::write(home.join("fail-verification"), "fixture").unwrap();
        assert!(run(crate::ai_integrations::connect_ai_service(
            "claude".into(),
            Some("I understand".into())
        ))
        .is_err());
        assert_eq!(std::fs::read(&cfg_path).unwrap(), legacy_bytes);
        assert_eq!(
            std::fs::read_to_string(home.join("calls.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        std::fs::remove_file(home.join("fail-verification")).unwrap();
        std::fs::remove_file(home.join("calls.jsonl")).unwrap();
        run(crate::ai_integrations::connect_ai_service(
            "claude".into(),
            Some("I understand".into()),
        ))
        .unwrap();
        assert_eq!(
            crate::ai_integrations::selected_provider()
                .unwrap()
                .as_deref(),
            Some("claude")
        );
        let draft = run(crate::git_summary::git_summarize(
            repo.to_string_lossy().into_owned(),
            "staged".into(),
        ))
        .unwrap();
        assert_eq!(draft, "feat: reuse existing CLI login");
        assert_eq!(std::fs::read_to_string(&byok).unwrap(), config);
        let calls = std::fs::read_to_string(home.join("calls.jsonl")).unwrap();
        let requests: Vec<serde_json::Value> = calls
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .filter(|v: &serde_json::Value| v["input"].as_str().is_some_and(|s| !s.is_empty()))
            .collect();
        assert_eq!(requests.len(), 2); // explicit verification, then the draft
        assert!(requests
            .iter()
            .all(|v| !v["cwd"].as_str().unwrap().contains("repo")));
        let claude_prompt = requests[1]["input"].as_str().unwrap();
        assert!(claude_prompt.contains("test change"));
        assert!(claude_prompt.contains("Conventional Commits 1.0.0"));
        assert!(claude_prompt.contains("<type>[optional scope][!]: <description>"));
        assert!(claude_prompt.contains("BREAKING CHANGE: <explanation>"));
        assert!(!calls.contains("existing-test-key"));
        // A later API selection waits for an in-flight verification, then wins.
        let checking = std::thread::spawn(|| {
            tauri::async_runtime::block_on(crate::ai_integrations::connect_ai_service(
                "claude".into(),
                None,
            ))
        });
        let started = std::time::Instant::now();
        while !home.join("checking").exists() {
            assert!(started.elapsed() < std::time::Duration::from_secs(5));
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        run(crate::ai_integrations::finish_ai_setup(true)).unwrap();
        checking.join().unwrap().unwrap();
        assert!(crate::ai_integrations::selected_provider()
            .unwrap()
            .is_none());
        assert!(!run(crate::ai_integrations::needs_ai_setup()).unwrap());
        run(crate::ai_integrations::connect_ai_service(
            "codex".into(),
            None,
        ))
        .unwrap();
        let draft = run(crate::git_summary::git_summarize(
            repo.to_string_lossy().into_owned(),
            "staged".into(),
        ))
        .unwrap();
        assert_eq!(draft, "feat: reuse existing CLI login");
        let native = run(crate::ai_native::get_codex_agent_env())
            .unwrap()
            .unwrap();
        let command: serde_json::Value =
            serde_json::from_str(&native["CAIRNGORM_CODEX_COMMAND"]).unwrap();
        assert!(command["args"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "sandbox_mode=\"workspace-write\""));
        assert_eq!(
            native["CODEX_HOME"],
            crate::ai_runtime::AiRuntime::default()
                .config_home("codex")
                .unwrap()
                .to_string_lossy()
        );
        assert!(!serde_json::to_string(&native)
            .unwrap()
            .contains("existing-test-key"));
        let calls = std::fs::read_to_string(home.join("calls.jsonl")).unwrap();
        let codex_call: serde_json::Value =
            serde_json::from_str(calls.lines().last().unwrap()).unwrap();
        assert_eq!(codex_call["input"].as_str().unwrap(), claude_prompt);
        assert!(codex_call["args"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "--ignore-user-config"));
        assert!(codex_call["args"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "--ignore-rules"));
        assert_eq!(std::fs::read_to_string(&byok).unwrap(), config);
        let folder = home.join("custom codex account");
        std::fs::create_dir(&folder).unwrap();
        let binary = home.join("custom codex.js");
        std::fs::copy(
            home.join("npm/node_modules/@openai/codex/bin/codex.js"),
            &binary,
        )
        .unwrap();
        let runtime = crate::ai_runtime::AiRuntime {
            binary_path: binary.to_string_lossy().into_owned(),
            home_path: folder.to_string_lossy().into_owned(),
        };
        let view = run(crate::ai_integrations::save_ai_runtime(
            "codex".into(),
            runtime.clone(),
        ))
        .unwrap();
        let view = serde_json::to_value(view).unwrap();
        assert_eq!(view["services"][0]["cliPath"], runtime.binary_path);
        assert_eq!(view["services"][0]["homePath"], runtime.home_path);
        assert!(run(crate::ai_native::get_codex_agent_env())
            .unwrap()
            .is_none());
        assert!(crate::ai_integrations::selected_provider()
            .unwrap()
            .is_none()); // Changing accounts requires re-verification.
        let cfg_path = home.join(".panel/agent/integrations.json");
        let before = std::fs::read(&cfg_path).unwrap();
        let invalid = crate::ai_runtime::AiRuntime {
            binary_path: "codex;evil".into(),
            home_path: String::new(),
        };
        assert!(run(crate::ai_integrations::save_ai_runtime(
            "codex".into(),
            invalid
        ))
        .is_err());
        assert_eq!(std::fs::read(&cfg_path).unwrap(), before);
        run(crate::ai_integrations::connect_ai_service(
            "codex".into(),
            None,
        ))
        .unwrap();
        let before = std::fs::read(&cfg_path).unwrap();
        for name in ["not-executable.txt", "not-executable.exe"] {
            let path = home.join(name);
            std::fs::write(&path, "not executable").unwrap();
            let invalid = crate::ai_runtime::AiRuntime {
                binary_path: path.to_string_lossy().into_owned(),
                home_path: String::new(),
            };
            assert!(run(crate::ai_integrations::save_ai_runtime(
                "codex".into(),
                invalid
            ))
            .is_err());
            assert_eq!(std::fs::read(&cfg_path).unwrap(), before);
            assert_eq!(
                crate::ai_integrations::selected_provider()
                    .unwrap()
                    .as_deref(),
                Some("codex")
            );
        }
        let native = run(crate::ai_native::get_codex_agent_env())
            .unwrap()
            .unwrap();
        assert_eq!(native["CODEX_HOME"], runtime.home_path);
        assert!(
            native["CAIRNGORM_CODEX_COMMAND"].contains(&runtime.binary_path.replace('\\', "\\\\"))
        );
        assert_eq!(
            run(crate::git_summary::git_summarize(
                repo.to_string_lossy().into_owned(),
                "staged".into()
            ))
            .unwrap(),
            "feat: reuse existing CLI login"
        );
        let checks = std::fs::read_to_string(home.join("checks.jsonl")).unwrap();
        let last: serde_json::Value = serde_json::from_str(checks.lines().last().unwrap()).unwrap();
        assert_eq!(last["binary"], runtime.binary_path);
        assert_eq!(last["configHome"], runtime.home_path);
        assert!(checks
            .lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .any(|v| v["args"][0] == "exec" && v["configHome"] == runtime.home_path));
        assert_eq!(std::fs::read_to_string(&byok).unwrap(), config);
        return;
    }
    let home = std::env::temp_dir().join(format!("cairngorm-routing-{}", uuid::Uuid::new_v4()));
    let npm = home.join("npm/node_modules/@anthropic-ai/claude-code");
    std::fs::create_dir_all(&npm).unwrap();
    let stub = r#"
const fs = require('node:fs');
const path = require('node:path');
const home = process.env.USERPROFILE || process.env.HOME;
const args = process.argv.slice(2);
const isCodex = process.argv[1].includes('codex');
fs.appendFileSync(path.join(home, 'checks.jsonl'), JSON.stringify({args,binary:process.argv[1],configHome:process.env[isCodex ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR']}) + '\n');
if (args[0] === 'login') { console.error('Logged in using ChatGPT'); process.exit(0); }
if (isCodex && args[0] === 'exec' && (!args.includes('--ignore-user-config') || !args.includes('--ignore-rules'))) { console.error('invalid transport in inherited config'); process.exit(1); }
if (args[0] === 'auth') { console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})); process.exit(0); }
if (!isCodex && (!args.includes('--bare') || !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX || process.env.ANTHROPIC_BASE_URL)) { console.error('unsafe Claude auth'); process.exit(1); }
let input = '';
process.stdin.on('data', x => input += x);
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(home, 'calls.jsonl'), JSON.stringify({args,input,cwd:process.cwd()}) + '\n');
  const verify = input.includes('exactly CAIRNGORM_OK');
  if (!isCodex && verify && fs.existsSync(path.join(home, 'fail-verification'))) {
    console.log(JSON.stringify({is_error:true,result:'Fixture verification failure'})); return;
  }
  const result = verify ? 'CAIRNGORM_OK' : 'feat: reuse existing CLI login';
  if (isCodex) { console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:result}})); return; }
  if (verify && fs.readFileSync(path.join(home, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).length > 2) {
    fs.writeFileSync(path.join(home, 'checking'), '1');
    setTimeout(() => console.log(JSON.stringify({is_error:false,result})), 300);
  } else console.log(JSON.stringify({is_error:false,result}));
});
"#;
    std::fs::write(npm.join("cli.js"), stub).unwrap();
    let codex = home.join("npm/node_modules/@openai/codex/bin");
    std::fs::create_dir_all(&codex).unwrap();
    std::fs::write(codex.join("codex.js"), stub).unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap());
    child.args(["--exact", "ai_commit_routing_tests::existing_cli_verification_provisions_commit_drafts_without_changing_byok", "--nocapture"])
        .env("CAIRNGORM_AI_TEST_CHILD", "1").env("CAIRNGORM_AI_TEST_HOME", &home)
        .env("USERPROFILE", &home).env("HOME", &home).env("APPDATA", &home)
        .env("ANTHROPIC_API_KEY", "scratch-api-key")
        .env("ANTHROPIC_AUTH_TOKEN", "subscription-must-not-reach-cli")
        .env("CLAUDE_CODE_OAUTH_TOKEN", "subscription-must-not-reach-cli")
        .env("CLAUDE_CODE_USE_BEDROCK", "1").env("CLAUDE_CODE_USE_VERTEX", "1")
        .env("ANTHROPIC_BASE_URL", "https://untrusted.invalid");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bin = home.join("bin");
        std::fs::create_dir(&bin).unwrap();
        let wrapper = bin.join("claude");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nexec node '{}' \"$@\"\n",
                npm.join("cli.js").display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
        let wrapper = bin.join("codex");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nexec node '{}' \"$@\"\n",
                codex.join("codex.js").display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = std::env::var("PATH").unwrap_or_default();
        child.env("PATH", format!("{}:{path}", bin.display()));
    }
    let output = child.output().unwrap();
    std::fs::remove_dir_all(home).unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
