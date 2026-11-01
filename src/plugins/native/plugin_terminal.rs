//! Which Cairngorm terminal a bridge runs in, and which agent process started it. The
//! process tree is the ground truth: every bridge descends from a terminal's shell, and
//! the agent sits between them. `CAIRNGORM_TERMINAL` is the fallback for agents that
//! launch MCP servers outside their own tree; it is inherited by anything started from a
//! terminal (an editor, tmux), so it only counts for a live terminal.
use sysinfo::{Pid, ProcessRefreshKind, System, UpdateKind};

const MAX_DEPTH: usize = 32;

#[derive(Debug, Default, PartialEq)]
pub struct Found {
    pub terminal: Option<String>,
    /// The nearest ancestor whose name or command line names a known agent CLI.
    pub agent_hint: Option<&'static str>,
}

impl Found {
    /// The agent that may use file tools for `terminal` (the caller's live terminal). When the
    /// walk reached a terminal it must be that one; agents hosted outside the terminal's tree
    /// (Claude Code's PTY host) are matched through CAIRNGORM_TERMINAL instead. Either way the
    /// agent is a real process ancestor, checked for a bridge registration afterwards.
    pub fn verified_agent(&self, terminal: Option<&str>) -> Option<&'static str> {
        let terminal = terminal?;
        match self.terminal.as_deref() {
            Some(walked) if walked != terminal => None,
            _ => self.agent_hint,
        }
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c))
}

pub fn resolve(env_terminal: Option<&str>, pid: Option<&str>) -> Found {
    let mut found = pid
        .and_then(|p| p.parse::<u32>().ok())
        .map(walk)
        .unwrap_or_default();
    if found.terminal.is_none() {
        found.terminal = env_terminal
            .filter(|id| valid_id(id) && crate::pty::session_exists(id))
            .map(String::from);
    }
    found
}

/// Climbs from the bridge to the terminal's root shell, noting the agent on the way.
fn walk(bridge: u32) -> Found {
    walk_to(bridge, crate::pty::session_for_pid)
}

fn walk_to(bridge: u32, session_for_pid: impl Fn(u32) -> Option<String>) -> Found {
    let mut found = Found::default();
    let mut system = System::new();
    // Name, executable and command line only: a full refresh costs far more.
    let kind = ProcessRefreshKind::new()
        .with_exe(UpdateKind::OnlyIfNotSet)
        .with_cmd(UpdateKind::OnlyIfNotSet);
    let mut current = Pid::from_u32(bridge);
    for _ in 0..MAX_DEPTH {
        if let Some(session) = session_for_pid(current.as_u32()) {
            found.terminal = Some(session);
        }
        if !system.refresh_process_specifics(current, kind) {
            return found;
        }
        let Some(process) = system.process(current) else {
            return found;
        };
        if current.as_u32() != bridge && found.agent_hint.is_none() {
            let exe = process
                .exe()
                .map(|e| e.to_string_lossy())
                .unwrap_or_default();
            found.agent_hint =
                super::callers::agent_of_process(process.name(), &exe, process.cmd());
        }
        // A direct CLI profile is itself the PTY root; inspect it before ending the walk.
        if found.terminal.is_some() {
            return found;
        }
        let (Some(parent), started) = (process.parent(), process.start_time()) else {
            return found;
        };
        // A dead parent's pid can be reused; a real parent never starts after its child.
        if !system.refresh_process_specifics(parent, kind)
            || system
                .process(parent)
                .is_none_or(|p| p.start_time() > started)
        {
            return found;
        }
        current = parent;
    }
    found
}

#[cfg(test)]
#[path = "../../../tests/native/plugin_terminal.rs"]
mod tests;
