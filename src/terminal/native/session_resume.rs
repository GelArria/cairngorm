//! How each agent reopens a reported conversation, with the launch state it carries over.
//! Reports are written by processes inside the pane, so every value is validated here and
//! only known flags with known values become arguments.
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
pub(crate) struct Report {
    pub agent: String,
    pub id: String,
    pub path: Option<String>,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    /// Launch flags captured from the agent's own command line (filtered again below).
    #[serde(default)]
    pub flags: Vec<String>,
}

/// Reported agent, its executable, its Node package folder and how it reopens a conversation.
/// Codex takes the id as a `resume` subcommand argument; Copilot's exact-id flag is used
/// because its `--resume` value is optional and also matches prefixes and names.
pub(crate) const AGENTS: &[(&str, &str, &str, &str)] = &[
    ("pi", "pi", "pi-coding-agent", "--session"),
    ("opencode", "opencode", "opencode-ai", "--session"),
    ("droid", "droid", "droid", "--resume"),
    ("claude", "claude", "claude-code", "--resume"),
    ("codex", "codex", "codex", "resume"),
    ("gemini", "gemini", "gemini-cli", "--resume"),
    ("qwen", "qwen", "qwen-code", "--resume"),
    ("copilot", "copilot", "copilot", "--session-id"),
    ("cursor", "cursor-agent", "cursor-agent", "--resume"),
    ("grok", "grok", "grok", "--resume"),
];

enum Kind {
    Switch,
    Values(&'static [&'static str]),
    /// Tool name lists such as `read,grep,mcp__*`.
    Pattern,
}

/// Launch flags restored with a conversation: (agent, spelling, canonical flag, value kind).
/// Pi's are restrictive (tools and plan mode); Cursor, Gemini and Qwen keep their approval mode.
const LAUNCH_FLAGS: &[(&str, &str, &str, Kind)] = &[
    ("pi", "--tools", "--tools", Kind::Pattern),
    ("pi", "-t", "--tools", Kind::Pattern),
    ("pi", "--exclude-tools", "--exclude-tools", Kind::Pattern),
    ("pi", "-xt", "--exclude-tools", Kind::Pattern),
    ("pi", "--no-tools", "--no-tools", Kind::Switch),
    ("pi", "-nt", "--no-tools", Kind::Switch),
    (
        "pi",
        "--no-builtin-tools",
        "--no-builtin-tools",
        Kind::Switch,
    ),
    ("pi", "-nbt", "--no-builtin-tools", Kind::Switch),
    ("pi", "--no-mcp", "--no-mcp", Kind::Switch),
    ("pi", "--plan", "--plan", Kind::Switch),
    ("cursor", "--force", "--force", Kind::Switch),
    ("cursor", "-f", "--force", Kind::Switch),
    ("cursor", "--yolo", "--force", Kind::Switch),
    ("cursor", "--mode", "--mode", Kind::Values(&["plan", "ask"])),
    ("cursor", "--plan", "--mode", Kind::Switch),
    (
        "cursor",
        "--sandbox",
        "--sandbox",
        Kind::Values(&["enabled", "disabled"]),
    ),
    ("gemini", "--yolo", "--yolo", Kind::Switch),
    ("gemini", "-y", "--yolo", Kind::Switch),
    (
        "gemini",
        "--approval-mode",
        "--approval-mode",
        Kind::Values(&["default", "auto_edit", "yolo", "plan"]),
    ),
    ("qwen", "--yolo", "--yolo", Kind::Switch),
    ("qwen", "-y", "--yolo", Kind::Switch),
    (
        "qwen",
        "--approval-mode",
        "--approval-mode",
        Kind::Values(&["plan", "default", "auto-edit", "auto", "yolo"]),
    ),
];

pub(crate) fn valid_id(id: &str) -> bool {
    // A leading '-' would be read as a CLI flag after an optional-value flag such as --resume.
    id.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && id.len() <= 512
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && id != "."
        && id != ".."
}

pub(crate) fn quote(value: &str, powershell: bool) -> String {
    let mut out = String::from("'");
    for ch in value.chars() {
        // PowerShell also ends single-quoted strings at typographic quotes; doubling escapes them.
        if powershell && matches!(ch, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            out.push(ch);
            out.push(ch);
        } else if !powershell && ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

fn valid_pattern(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_*.,:/@-".contains(&b))
}

/// Known launch flags from a report, canonicalized; the last occurrence wins, as in the CLIs.
/// Unknown flags are dropped, but a restrictive Pi flag that cannot be honoured refuses the
/// resume (None) rather than reopening the session with more tools.
fn launch_flags(agent: &str, flags: &[String]) -> Option<Vec<Vec<String>>> {
    let mut groups: Vec<Vec<String>> = Vec::new();
    if flags.len() > 32 {
        return (agent != "pi").then_some(groups);
    }
    let mut items = flags.iter();
    while let Some(item) = items.next() {
        let (name, inline) = match item.split_once('=') {
            Some((name, value)) => (name, Some(value.to_string())),
            None => (item.as_str(), None),
        };
        let Some((_, _, canonical, kind)) = LAUNCH_FLAGS
            .iter()
            .find(|(a, spelling, ..)| *a == agent && *spelling == name)
        else {
            continue;
        };
        let group = match kind {
            // `--yolo=false` disables a switch: never restore it as enabled.
            Kind::Switch if inline.is_some() => continue,
            // `--plan` is Cursor's shorthand for `--mode plan`.
            Kind::Switch if *canonical == "--mode" => vec![canonical.to_string(), "plan".into()],
            Kind::Switch => vec![canonical.to_string()],
            Kind::Values(values) => {
                let value = inline.or_else(|| items.next().cloned());
                match value.filter(|v| values.contains(&v.as_str())) {
                    Some(value) => vec![canonical.to_string(), value],
                    None => continue,
                }
            }
            Kind::Pattern => {
                let value = inline.or_else(|| items.next().cloned());
                match value.filter(|v| valid_pattern(v)) {
                    Some(value) => vec![canonical.to_string(), value],
                    None => return None,
                }
            }
        };
        groups.retain(|g| g[0] != group[0]);
        groups.push(group);
    }
    Some(groups)
}

/// The agent reported a conversation file that does not exist: it was opened but never used
/// (Pi and Claude save on the first message). Resuming it would fail, so the pane starts the
/// agent the way it was launched instead. Reports without a path (older ones) still resume.
pub(crate) fn unsaved(report: &Report) -> bool {
    matches!(report.agent.as_str(), "pi" | "claude")
        && report
            .path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_absolute() && !Path::new(path).is_file())
}

/// The agent's executable and its argument groups: the conversation reference first, then
/// permission and launch flags, each group starting with its flag.
pub(crate) fn resume_args(report: &Report) -> Option<(&'static str, Vec<Vec<String>>)> {
    if !valid_id(&report.id) {
        return None;
    }
    let (agent, command, flag) = AGENTS
        .iter()
        .find(|(agent, ..)| *agent == report.agent)
        .map(|(agent, command, _, flag)| (*agent, *command, *flag))?;
    if unsaved(report) {
        return None;
    }
    let value = if agent == "pi" {
        match report.path.as_deref() {
            Some(path)
                if Path::new(path).is_absolute()
                    && Path::new(path).is_file()
                    && path.len() <= 4096
                    && !path.chars().any(char::is_control) =>
            {
                path
            }
            // Pi saves lazily: an empty/nonexistent session must not create a new conversation on restore.
            _ => return None,
        }
    } else {
        &report.id
    };
    let mut groups = vec![vec![flag.to_string(), value.to_string()]];
    // Only known modes become flags; hook reports are data, never shell fragments.
    match (agent, report.permission_mode.as_deref()) {
        ("claude", Some("bypassPermissions")) => {
            groups.push(vec!["--dangerously-skip-permissions".into()])
        }
        (
            "claude",
            Some(mode @ ("default" | "manual" | "acceptEdits" | "plan" | "dontAsk" | "auto")),
        ) => groups.push(vec!["--permission-mode".into(), mode.into()]),
        // Codex reports only "default" or "bypassPermissions" (no approvals, no sandbox).
        ("codex", Some("bypassPermissions")) => {
            groups.push(vec!["--dangerously-bypass-approvals-and-sandbox".into()])
        }
        ("grok", Some(mode @ ("default" | "auto" | "plan" | "bypassPermissions"))) => {
            groups.push(vec!["--permission-mode".into(), mode.into()])
        }
        _ => {}
    }
    groups.extend(launch_flags(agent, &report.flags)?);
    Some((command, groups))
}

/// The resume command for a shell prompt. Values outside a plain word are quoted.
pub(crate) fn resume(report: &Report, powershell: bool) -> Option<String> {
    let (command, groups) = resume_args(report)?;
    let mut parts = vec![command.to_string()];
    for (index, group) in groups.iter().enumerate() {
        parts.push(group[0].clone());
        if let Some(value) = group.get(1) {
            let word = value
                .bytes()
                .all(|b| b.is_ascii_alphabetic() || b"_-".contains(&b));
            parts.push(if index > 0 && word {
                value.clone()
            } else {
                quote(value, powershell)
            });
        }
    }
    Some(parts.join(" "))
}

/// Where the agent's own arguments start when the profile's CLI is the reported agent
/// (0 for its native binary, 1 after its Node entry script).
pub(crate) fn agent_args_start(
    command: &str,
    cli: &crate::launch_profiles::ProfileCli,
) -> Option<usize> {
    let stem = |path: &str| {
        Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default()
    };
    let program = stem(&cli.program);
    if program == command {
        return Some(0);
    }
    let (_, _, package, _) = AGENTS.iter().find(|(_, cmd, ..)| *cmd == command)?;
    let script = cli.args.first()?;
    (matches!(program.as_str(), "node" | "bun")
        && Path::new(script)
            .components()
            .any(|part| part.as_os_str().eq_ignore_ascii_case(package)))
    .then_some(1)
}

#[cfg(test)]
#[path = "../../../tests/native/session-resume.rs"]
mod tests;

#[cfg(test)]
#[path = "../../../tests/native/session-live.rs"]
mod live_tests;
