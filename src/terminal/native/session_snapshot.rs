//! Capture which reported agents are still open before the app tears down its PTYs.
use std::{collections::HashMap, io::Read, path::Path};
use sysinfo::{ProcessRefreshKind, System, UpdateKind};

#[derive(Clone)]
struct Process {
    parent: Option<u32>,
    started: u64,
    agent: Option<&'static str>,
    headless: bool,
    unknown_program: bool,
}

#[derive(Debug, PartialEq)]
enum PaneState {
    Agent(&'static str),
    Shell,
    // shortcut: unsupported programs keep their original launch; add a native report bridge to resume their conversation.
    Unreported,
}

/// A nested agent/tool never replaces the pane's outer interactive agent.
fn pane_agent(root: u32, processes: &HashMap<u32, Process>) -> Option<&'static str> {
    let root_process = processes.get(&root)?;
    if root_process.agent.is_some() {
        return (!root_process.headless)
            .then_some(root_process.agent)
            .flatten();
    }
    processes.iter().find_map(|(&pid, process)| {
        let agent = process.agent.filter(|_| !process.headless)?;
        let mut current = pid;
        for _ in 0..32 {
            let child = processes.get(&current)?;
            let parent = child.parent?;
            let ancestor = processes.get(&parent)?;
            if ancestor.started > child.started || ancestor.agent.is_some() {
                return None;
            }
            if parent == root {
                return Some(agent);
            }
            current = parent;
        }
        None
    })
}

fn read_report(file: &Path) -> Result<Option<super::Report>, String> {
    match std::fs::File::open(file) {
        Ok(file) => {
            let mut text = String::new();
            file.take(8193)
                .read_to_string(&mut text)
                .map_err(|e| e.to_string())?;
            if text.len() > 8192 {
                return Err("Agent session report is too large".into());
            }
            Ok(Some(
                serde_json::from_str::<super::Report>(&text).map_err(|e| e.to_string())?,
            ))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn record(file: &Path, state: PaneState) -> Result<(), String> {
    if let PaneState::Agent(agent) = state {
        if read_report(file)?
            .as_ref()
            .is_some_and(|r| r.agent == agent && super::valid_id(&r.id))
        {
            return Ok(());
        }
        return Err(format!(
            "The open {agent} session has not reported its restore reference yet"
        ));
    }
    // A confirmed shell does not need an old conversation; corrupt metadata must not block close.
    let cwd = read_report(file).ok().flatten().and_then(|r| r.cwd);
    let marker = if state == PaneState::Shell {
        "shell"
    } else {
        "unreported"
    };
    let value = serde_json::json!({ "agent": marker, "id": marker, "cwd": cwd });
    let temporary = file.with_extension("snapshot.tmp");
    std::fs::write(&temporary, value.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, file).map_err(|e| e.to_string())
}

fn pane_state(root: u32, processes: &HashMap<u32, Process>) -> PaneState {
    if let Some(agent) = pane_agent(root, processes) {
        return if super::AGENTS.iter().any(|(known, ..)| *known == agent) {
            PaneState::Agent(agent)
        } else {
            PaneState::Unreported
        };
    }
    // Unknown live programs are not evidence that the user returned to a shell.
    let unknown = processes.iter().any(|(&pid, process)| {
        if !process.unknown_program || process.headless {
            return false;
        }
        let mut current = pid;
        for _ in 0..32 {
            if current == root {
                return true;
            }
            let Some(child) = processes.get(&current) else {
                return false;
            };
            let Some(parent) = child
                .parent
                .and_then(|p| processes.get(&p).map(|node| (p, node)))
            else {
                return false;
            };
            if parent.1.started > child.started || parent.1.agent.is_some() {
                return false;
            }
            current = parent.0;
        }
        false
    });
    if unknown {
        PaneState::Unreported
    } else {
        PaneState::Shell
    }
}

fn headless(agent: Option<&str>, args: &[String]) -> bool {
    if !agent.is_some_and(|agent| super::AGENTS.iter().any(|(known, ..)| *known == agent)) {
        return false;
    }
    args.iter().any(|arg| {
        matches!(
            arg.as_str(),
            "-p" | "--print" | "--prompt" | "--mode=json" | "--mode=rpc"
        ) || arg.starts_with("--print=")
            || arg.starts_with("--prompt=")
    }) || args
        .windows(2)
        .any(|pair| pair[0] == "--mode" && matches!(pair[1].as_str(), "json" | "rpc"))
        || (agent == Some("codex") && args.iter().any(|arg| arg == "exec"))
}

fn process_tree() -> HashMap<u32, Process> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessRefreshKind::new()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cmd(UpdateKind::OnlyIfNotSet),
    );
    system
        .processes()
        .iter()
        .map(|(pid, p)| {
            let exe = p.exe().map(|e| e.to_string_lossy()).unwrap_or_default();
            let agent = crate::plugins::agent_of_process(p.name(), &exe, p.cmd());
            let headless = matches!(
                p.status(),
                sysinfo::ProcessStatus::Zombie | sysinfo::ProcessStatus::Dead
            ) || headless(agent, p.cmd());
            let name = p.name().to_ascii_lowercase();
            let shell = matches!(
                name.strip_suffix(".exe").unwrap_or(&name),
                "powershell"
                    | "pwsh"
                    | "cmd"
                    | "bash"
                    | "sh"
                    | "zsh"
                    | "dash"
                    | "fish"
                    | "env"
                    | "conhost"
                    | "openconsole"
            );
            (
                *pid,
                Process {
                    parent: p.parent().map(|p| p.as_u32()),
                    started: p.start_time(),
                    agent,
                    headless,
                    unknown_program: agent.is_none() && !shell,
                },
            )
        })
        .map(|(pid, p)| (pid.as_u32(), p))
        .collect()
}

/// How many of these terminal roots run an agent or another program, not just their shell.
pub(crate) fn busy_panes(roots: &[u32]) -> usize {
    if roots.is_empty() {
        return 0;
    }
    let processes = process_tree();
    roots
        .iter()
        .filter(|&&root| {
            processes.contains_key(&root) && pane_state(root, &processes) != PaneState::Shell
        })
        .count()
}

pub(crate) fn capture(
    app: &tauri::AppHandle,
    terminals: Vec<(String, Option<u32>)>,
) -> Result<(), String> {
    if terminals.is_empty() {
        return Ok(());
    }
    let processes = process_tree();
    for (id, root) in terminals {
        if root.is_some_and(|pid| !processes.contains_key(&pid)) {
            return Err(format!("Could not inspect terminal {id}; keeping it open"));
        }
        let state = root.map_or(PaneState::Shell, |pid| pane_state(pid, &processes));
        record(&super::report_path(app, &id)?, state)
            .map_err(|e| format!("Could not save terminal {id}: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../../tests/native/session-snapshot.rs"]
mod tests;
