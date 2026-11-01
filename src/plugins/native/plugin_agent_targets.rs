//! Where each supported agent CLI keeps its MCP servers, and the entry shape it expects.
//! Ids match `plugin_callers::AGENTS`, which recognises the same agents when they call.
use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
pub enum Style {
    Stdio,
    TypedStdio,
    Copilot,
    OpenCode,
}

#[derive(Clone, Copy)]
pub enum Format {
    Json(&'static str, Style),
    Toml,
}

pub struct Target {
    pub id: &'static str,
    pub name: &'static str,
    /// Folders whose presence means the CLI is set up; any one is enough.
    pub markers: Vec<PathBuf>,
    pub file: PathBuf,
    pub format: Format,
}

impl Target {
    pub fn installed(&self) -> bool {
        self.markers.iter().any(|dir| dir.is_dir())
    }
}

/// Reads an environment override; tests pass their own so they never see the real one.
pub type Env<'a> = &'a dyn Fn(&str) -> Option<std::ffi::OsString>;

/// Kiro ignores a home that is relative, the user's home or one of its ancestors.
fn kiro_home(home: &Path, env: Env) -> PathBuf {
    env("KIRO_HOME")
        .map(PathBuf::from)
        .filter(|dir| dir.is_absolute() && !home.starts_with(dir))
        .unwrap_or_else(|| home.join(".kiro"))
}

/// The JSONC spelling when only that one exists; a new config uses the plain JSON name.
fn json_or_jsonc(dir: &Path, stem: &str) -> PathBuf {
    let json = dir.join(format!("{stem}.json"));
    let jsonc = dir.join(format!("{stem}.jsonc"));
    if jsonc.exists() && !json.exists() {
        jsonc
    } else {
        json
    }
}

pub fn targets(home: &Path, env: Env) -> Vec<Target> {
    let env_dir = |name: &str| env(name).map(PathBuf::from);
    let config = env_dir("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config"));
    let codex = env_dir("CODEX_HOME").unwrap_or_else(|| home.join(".codex"));
    let kiro = kiro_home(home, env);
    let gemini = crate::agent_integrations::gemini_dir(home, env);
    let kimi = env_dir("KIMI_CODE_HOME").unwrap_or_else(|| home.join(".kimi-code"));
    let opencode = config.join("opencode");
    let amp = config.join("amp");
    let pi = env_dir("PI_CODING_AGENT_DIR").unwrap_or_else(|| home.join(".pi/agent"));
    // Adapter installations replace Pi's built-in MCP and use their own config.
    let pi_config = if pi.join("mcp-adapter.json").exists() {
        pi.join("mcp-adapter.json")
    } else {
        pi.join("mcp.json")
    };
    let target = |id, name, markers: Vec<PathBuf>, file: PathBuf, format| Target {
        id,
        name,
        markers,
        file,
        format,
    };
    let mcp_servers = |style| Format::Json("mcpServers", style);
    vec![
        target("pi", "Pi", vec![pi], pi_config, mcp_servers(Style::Stdio)),
        target(
            "claude",
            "Claude Code",
            vec![home.join(".claude")],
            home.join(".claude.json"),
            mcp_servers(Style::TypedStdio),
        ),
        target(
            "codex",
            "Codex",
            vec![codex.clone()],
            codex.join("config.toml"),
            Format::Toml,
        ),
        target(
            "gemini",
            "Gemini CLI",
            vec![gemini.clone()],
            gemini.join("settings.json"),
            mcp_servers(Style::Stdio),
        ),
        target(
            "opencode",
            "opencode",
            vec![opencode.clone()],
            json_or_jsonc(&opencode, "opencode"),
            Format::Json("mcp", Style::OpenCode),
        ),
        target(
            "droid",
            "Droid",
            vec![home.join(".factory")],
            home.join(".factory").join("mcp.json"),
            mcp_servers(Style::TypedStdio),
        ),
        target(
            "cursor",
            "Cursor CLI",
            vec![home.join(".cursor")],
            home.join(".cursor").join("mcp.json"),
            mcp_servers(Style::Stdio),
        ),
        target(
            "copilot",
            "GitHub Copilot CLI",
            vec![home.join(".copilot")],
            home.join(".copilot").join("mcp-config.json"),
            mcp_servers(Style::Copilot),
        ),
        // Amp's installer uses ~/.amp; its settings live under the config folder.
        target(
            "amp",
            "Amp",
            vec![amp.clone(), home.join(".amp")],
            json_or_jsonc(&amp, "settings"),
            Format::Json("amp.mcpServers", Style::Stdio),
        ),
        target(
            "qwen",
            "Qwen Code",
            vec![home.join(".qwen")],
            home.join(".qwen").join("settings.json"),
            mcp_servers(Style::Stdio),
        ),
        target(
            "kimi",
            "Kimi Code",
            vec![kimi.clone()],
            kimi.join("mcp.json"),
            mcp_servers(Style::Stdio),
        ),
        target(
            "kiro",
            "Kiro CLI",
            vec![kiro.clone()],
            kiro.join("settings").join("mcp.json"),
            mcp_servers(Style::Stdio),
        ),
        target(
            "auggie",
            "Auggie",
            vec![home.join(".augment")],
            home.join(".augment").join("settings.json"),
            mcp_servers(Style::TypedStdio),
        ),
    ]
}
