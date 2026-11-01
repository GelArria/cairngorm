use super::{agent_targets, agents, callers, catalog};
use serde_json::Value;
use std::{ffi::OsString, fs, path::PathBuf};

fn temp_home() -> PathBuf {
    let home =
        std::env::temp_dir().join(format!("cairngorm-plugin-agents-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&home).unwrap();
    home
}

/// No overrides: the developer's own XDG_CONFIG_HOME, CODEX_HOME… must never leak in.
fn no_env(_: &str) -> Option<OsString> {
    None
}

#[test]
fn every_catalog_plugin_is_off_until_added_and_has_a_bundled_logo() {
    let dir = temp_home();
    assert!(catalog::enabled(&dir).is_empty());
    let public = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public");
    for plugin in catalog::catalog().iter().filter(|p| !p.local_app) {
        assert!(plugin.server_url.starts_with("https://"), "{}", plugin.id);
        let logo = public.join(plugin.logo.trim_start_matches('/'));
        assert!(
            logo.is_file(),
            "{} logo missing at {}",
            plugin.id,
            logo.display()
        );
    }
    catalog::set_enabled(&dir, "drawio", true).unwrap();
    let ids: Vec<_> = catalog::enabled(&dir).iter().map(|p| p.id).collect();
    assert_eq!(ids, ["drawio"]);
    fs::remove_dir_all(dir).ok();
}

#[test]
fn local_office_and_all_craft_apps_are_in_the_plugin_catalog() {
    for id in [
        "microsoft-word",
        "microsoft-excel",
        "microsoft-powerpoint",
        "libreoffice-writer",
        "libreoffice-calc",
        "libreoffice-impress",
        "photocraft",
        "vectorcraft",
        "filmcraft",
        "lightcraft",
        "pdfcraft",
        "effectcraft",
        "designcraft",
        "figcraft",
        "wordcraft",
        "soundcraft",
        "deckcraft",
        "cadcraft",
        "gridcraft",
    ] {
        assert!(
            catalog::find(id).is_some(),
            "missing catalog integration: {id}"
        );
    }
}

#[test]
fn only_installed_agents_are_listed_and_amp_counts_from_its_install_folder() {
    let home = temp_home();
    let bridge = "C:/app/plugins/mcp-bridge.cjs";
    assert!(agents::status(&home, &no_env, bridge).is_empty());
    // Amp's installer leaves ~/.amp before any settings file exists.
    fs::create_dir_all(home.join(".amp")).unwrap();
    fs::create_dir_all(home.join(".qwen")).unwrap();
    let ids: Vec<_> = agents::status(&home, &no_env, bridge)
        .iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(ids, ["amp", "qwen"]);
    fs::remove_dir_all(home).ok();
}

#[test]
fn new_agents_get_their_own_config_shape() {
    let home = temp_home();
    let bridge = "C:/app/plugins/mcp-bridge.cjs";
    for dir in [".amp", ".qwen", ".kimi-code", ".kiro", ".augment"] {
        fs::create_dir_all(home.join(dir)).unwrap();
    }
    let report = agents::register(&home, &no_env, "node", bridge);
    assert!(report.iter().all(|a| a.registered && a.error.is_none()));
    let read = |path: PathBuf| -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    };
    let amp = read(home.join(".config/amp/settings.json"));
    assert_eq!(amp["amp.mcpServers"]["cairngorm"]["args"][0], bridge);
    let kiro = read(home.join(".kiro/settings/mcp.json"));
    assert_eq!(kiro["mcpServers"]["cairngorm"]["command"], "node");
    let kimi = read(home.join(".kimi-code/mcp.json"));
    assert_eq!(kimi["mcpServers"]["cairngorm"]["args"][0], bridge);
    let auggie = read(home.join(".augment/settings.json"));
    assert_eq!(auggie["mcpServers"]["cairngorm"]["type"], "stdio");
    // Registering again changes nothing and still reports every agent as connected.
    let again = agents::status(&home, &no_env, bridge);
    assert_eq!(again.len(), 5);
    assert!(again.iter().all(|a| a.registered));
    fs::remove_dir_all(home).ok();
}

#[test]
fn every_agent_with_a_config_is_also_recognised_when_it_calls() {
    let home = temp_home();
    for target in agent_targets::targets(&home, &no_env) {
        assert!(callers::agent_name(target.id).is_some(), "{}", target.id);
    }
    fs::remove_dir_all(home).ok();
}

#[test]
fn gemini_cli_home_replaces_the_home_folder() {
    let home = temp_home();
    let gemini = |value: &str| {
        let value = OsString::from(value);
        let env = move |name: &str| (name == "GEMINI_CLI_HOME").then(|| value.clone());
        let targets = agent_targets::targets(&home, &env);
        targets.into_iter().find(|t| t.id == "gemini").unwrap().file
    };
    let custom = home.join("work-gemini");
    assert_eq!(
        gemini(&custom.to_string_lossy()),
        custom.join(".gemini").join("settings.json")
    );
    // Empty and relative values keep the default folder.
    assert_eq!(gemini(""), home.join(".gemini").join("settings.json"));
    assert_eq!(
        gemini("relative/gemini"),
        home.join(".gemini").join("settings.json")
    );
    fs::remove_dir_all(home).ok();
}

#[test]
fn kiro_home_overrides_follow_kiro_rules() {
    let home = temp_home();
    let kiro = |value: PathBuf| {
        let env = move |name: &str| (name == "KIRO_HOME").then(|| value.clone().into_os_string());
        let targets = agent_targets::targets(&home, &env);
        targets.into_iter().find(|t| t.id == "kiro").unwrap().file
    };
    let default = home.join(".kiro").join("settings").join("mcp.json");
    // Kiro falls back to ~/.kiro for a relative path, the home folder or an ancestor.
    assert_eq!(kiro(PathBuf::from("relative/kiro")), default);
    assert_eq!(kiro(home.clone()), default);
    assert_eq!(kiro(home.parent().unwrap().to_path_buf()), default);
    let custom = home.join("work-kiro");
    assert_eq!(
        kiro(custom.clone()),
        custom.join("settings").join("mcp.json")
    );
    fs::remove_dir_all(home).ok();
}

#[test]
fn new_agents_are_recognised_by_handshake_and_process() {
    assert_eq!(callers::agent_in("qwen-cli-mcp-client"), Some("qwen"));
    assert_eq!(callers::agent_in("Kimi Code/1.2"), Some("kimi"));
    assert_eq!(callers::agent_in("kiro-cli/2"), Some("kiro"));
    assert_eq!(callers::agent_in("augment-mcp-client"), Some("auggie"));
    // "amp" is too short to search for in free text.
    assert_eq!(callers::agent_in("example-client"), None);
    let of = |name: &str, cmd: &[&str]| {
        let cmd: Vec<String> = cmd.iter().map(|s| s.to_string()).collect();
        callers::agent_of_process(name, "", &cmd)
    };
    assert_eq!(of("amp.exe", &[]), Some("amp"));
    assert_eq!(of("ample.exe", &[]), None);
    assert_eq!(of("kiro-cli", &[]), Some("kiro"));
    assert_eq!(
        of("node.exe", &["node", r"C:\npm\@qwen-code\qwen-code\cli.js"]),
        Some("qwen")
    );
    // A project folder named like a short id is not that agent; a package folder is.
    assert_eq!(of("node.exe", &["node", r"C:\src\amp\client.js"]), None);
    assert_eq!(
        of("node.exe", &["node", r"C:\npm\@github\copilot\index.js"]),
        Some("copilot")
    );
    assert_eq!(callers::agent_name("auggie"), Some("Auggie"));
}
