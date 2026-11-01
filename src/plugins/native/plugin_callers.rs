//! Who is calling: which terminal, and which agent CLI. The MCP handshake's `clientInfo`
//! names the agent; the bridge's parent processes are the fallback for clients that send
//! a generic name. Answers are cached per bridge process and seen agents are remembered,
//! so Settings can tell "connected and in use" from "configured, not loaded yet".
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// Agent ids match `plugin_agent_targets`; the needles are lowercase. Earlier entries win,
/// so a fork that may still mention its parent (Qwen Code, from Gemini CLI) comes first.
/// Amp's id is too short to search for in text; its process name still identifies it.
const AGENTS: &[(&str, &str, &[&str])] = &[
    ("pi", "Pi", &["pi-coding-agent", "pi-mcp-adapter"]),
    ("claude", "Claude Code", &["claude"]),
    ("codex", "Codex", &["codex"]),
    ("qwen", "Qwen Code", &["qwen"]),
    ("gemini", "Gemini CLI", &["gemini"]),
    ("opencode", "opencode", &["opencode"]),
    ("droid", "Droid", &["droid", "factory"]),
    ("cursor", "Cursor CLI", &["cursor"]),
    ("copilot", "GitHub Copilot CLI", &["copilot"]),
    ("grok", "Grok", &["grok"]),
    ("amp", "Amp", &["ampcode"]),
    ("kimi", "Kimi Code", &["kimi"]),
    ("kiro", "Kiro CLI", &["kiro"]),
    ("auggie", "Auggie", &["auggie", "augment"]),
];

#[derive(Clone, Debug, PartialEq)]
pub struct Caller {
    pub terminal: Option<String>,
    /// Agent id from [`AGENTS`], when known.
    pub agent: Option<&'static str>,
}

pub fn agent_name(id: &str) -> Option<&'static str> {
    AGENTS
        .iter()
        .find(|(a, _, _)| *a == id)
        .map(|(_, name, _)| *name)
}

/// The agent a piece of text names (a clientInfo name, a process name or command line).
pub fn agent_in(text: &str) -> Option<&'static str> {
    let text = text.to_ascii_lowercase();
    if text == "pi" || text.starts_with("pi/") {
        return Some("pi");
    }
    AGENTS
        .iter()
        .find(|(_, _, needles)| needles.iter().any(|n| text.contains(n)))
        .map(|(id, _, _)| *id)
}

/// A path component or program name that *is* the agent: `claude`, `claude.exe`,
/// `claude-code`, `codex-x86_64`… but not `android` or `claude-sonnet-4-5`.
fn names_agent(component: &str, id: &str) -> bool {
    let component = component.to_ascii_lowercase();
    let stem = component.strip_suffix(".exe").unwrap_or(&component);
    let tail = stem.strip_prefix(id);
    let program = matches!(
        tail,
        Some("") | Some("-code") | Some("-cli") | Some("-agent")
    );
    program || tail.is_some_and(|t| t.starts_with("-x86") || t.starts_with("-aarch"))
}

/// The agent a process is: its program name and executable first, then the script it
/// runs (`node …/claude-code/cli.js`). Option values are skipped, so a model name
/// such as `--model claude-sonnet` never counts.
pub fn agent_of_process(name: &str, exe: &str, cmd: &[String]) -> Option<&'static str> {
    let executable = exe.rsplit(['/', '\\']).next().unwrap_or_default();
    if let Some((id, _, _)) = AGENTS
        .iter()
        .find(|(id, _, _)| names_agent(name, id) || names_agent(executable, id))
    {
        return Some(id);
    }
    let executable_lower = executable.to_ascii_lowercase();
    let name_lower = name.to_ascii_lowercase();
    let runtime = executable_lower
        .strip_suffix(".exe")
        .unwrap_or(&executable_lower);
    let runtime_name = name_lower.strip_suffix(".exe").unwrap_or(&name_lower);
    if !["node", "bun", "deno"]
        .iter()
        .any(|host| runtime.eq_ignore_ascii_case(host) || runtime_name.eq_ignore_ascii_case(host))
    {
        return None;
    }
    let mut args = cmd.iter().skip(1);
    let mut run_subcommand =
        matches!(runtime, "bun" | "deno") || matches!(runtime_name, "bun" | "deno");
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "run" if run_subcommand => {
                run_subcommand = false;
                continue;
            }
            "-e" | "--eval" | "-p" | "--print" => return None,
            "-r"
            | "--require"
            | "--import"
            | "--loader"
            | "--experimental-loader"
            | "--title"
            | "--conditions"
            | "--input-type"
            | "--env-file"
            | "--env-file-if-exists" => {
                args.next();
                continue;
            }
            _ if arg.starts_with("--eval=")
                || arg.starts_with("--print=")
                || arg.starts_with("-e")
                || arg.starts_with("-p") =>
            {
                return None
            }
            _ if arg.starts_with('-') => continue,
            _ => {}
        }
        // Only the interpreter's script names the agent, never its later positional inputs.
        let parts: Vec<_> = arg.split(['/', '\\']).collect();
        let script = parts.last()?;
        if let Some((id, _, _)) = AGENTS.iter().find(|(id, _, _)| names_agent(script, id)) {
            return Some(id);
        }
        if !["js", "mjs", "cjs", "ts"].iter().any(|extension| {
            script
                .to_ascii_lowercase()
                .ends_with(&format!(".{extension}"))
        }) {
            return None;
        }
        return crate::cli_catalog::CLIS
            .iter()
            .filter(|(id, _, _, _)| AGENTS.iter().any(|(known, _, _)| known == id))
            .find_map(|(id, _, _, package)| {
                let package: Vec<_> = package.split('/').collect();
                (!package[0].is_empty()
                    && parts[..parts.len() - 1].windows(package.len()).any(|path| {
                        path.iter()
                            .zip(&package)
                            .all(|(left, right)| left.eq_ignore_ascii_case(right))
                    }))
                .then_some(*id)
            });
    }
    None
}

/// The bridge pid is stable for its lifetime; a short cache spares a process walk per
/// message while still noticing a terminal that closed.
const CACHE_FOR: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Memory {
    by_bridge: HashMap<u32, (Caller, Instant)>,
    last_seen: HashMap<&'static str, Instant>,
}

fn memory() -> std::sync::MutexGuard<'static, Memory> {
    static MEMORY: OnceLock<Mutex<Memory>> = OnceLock::new();
    MEMORY
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Resolves the caller of one bridge message and records the agent as seen.
pub fn identify(client: Option<&str>, env_terminal: Option<&str>, pid: Option<&str>) -> Caller {
    let bridge = pid.and_then(|p| p.parse::<u32>().ok());
    let cached = bridge.and_then(|pid| {
        let memory = memory();
        let (caller, at) = memory.by_bridge.get(&pid)?;
        let live = caller
            .terminal
            .as_deref()
            .is_none_or(crate::pty::session_exists);
        (at.elapsed() < CACHE_FOR && live).then(|| caller.clone())
    });
    let fresh = cached.is_none();
    let mut caller = cached.unwrap_or_else(|| {
        let found = super::terminal::resolve(env_terminal, pid);
        Caller {
            terminal: found.terminal,
            agent: found.agent_hint,
        }
    });
    // The handshake is the agent's own word; it wins over a process-name guess.
    if let Some(agent) = client.and_then(agent_in) {
        caller.agent = Some(agent);
    }
    let mut memory = memory();
    if let Some(pid) = bridge {
        memory
            .by_bridge
            .retain(|_, (_, at)| at.elapsed() < CACHE_FOR);
        // The resolution time is kept, not refreshed per message: the answer expires
        // 30 s after it was made, so a reused pid soon gets a fresh look.
        let at = memory
            .by_bridge
            .get(&pid)
            .filter(|_| !fresh)
            .map_or_else(Instant::now, |(_, at)| *at);
        memory.by_bridge.insert(pid, (caller.clone(), at));
    }
    if let (Some(agent), Some(_)) = (caller.agent, &caller.terminal) {
        memory.last_seen.insert(agent, Instant::now());
    }
    caller
}

/// Seconds since each agent last talked to the gateway from a Cairngorm terminal.
pub fn last_seen() -> HashMap<&'static str, u64> {
    memory()
        .last_seen
        .iter()
        .map(|(id, at)| (*id, at.elapsed().as_secs()))
        .collect()
}
