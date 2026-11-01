//! Whether a terminal's launch command starts an agent with its permission checks off, so the
//! tab can say so. This covers sessions restored in a bypass mode and profiles that pass the
//! flag themselves; an agent started by hand inside a shell is not seen here.

/// Flags that turn approvals off whatever agent receives them.
const ALWAYS: &[&str] = &[
    "--dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
    "--yolo",
    "--allow-all-tools",
];

/// Flags that turn approvals off only for one agent (and mean something else elsewhere).
const FOR_AGENT: &[(&str, &[&str])] = &[
    ("cursor-agent", &["--force", "-f"]),
    ("gemini", &["-y"]),
    ("qwen", &["-y"]),
];

/// `--flag value` and `--flag=value` spellings that select a bypass mode.
const MODES: &[(&str, &str)] = &[
    ("--permission-mode", "bypassPermissions"),
    ("--approval-mode", "yolo"),
    ("--ask-for-approval", "never"),
    ("-a", "never"),
];

fn words(argv: &[String]) -> Vec<String> {
    // A shell's -Command/-c argument holds the whole command line as one string.
    argv.iter()
        .flat_map(|arg| arg.split_whitespace())
        .map(|word| {
            word.trim_matches(|c| matches!(c, '"' | '\'' | ';'))
                .to_string()
        })
        .filter(|word| !word.is_empty())
        .collect()
}

fn names(word: &str) -> String {
    let file = word.rsplit(['/', '\\']).next().unwrap_or(word);
    file.trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .to_ascii_lowercase()
}

pub(crate) fn permissions_off(argv: &[String]) -> bool {
    let words = words(argv);
    let agents: Vec<String> = words.iter().map(|word| names(word)).collect();
    words.iter().enumerate().any(|(index, word)| {
        if ALWAYS.contains(&word.as_str()) {
            return true;
        }
        if FOR_AGENT.iter().any(|(agent, flags)| {
            flags.contains(&word.as_str()) && agents.iter().any(|a| a == agent)
        }) {
            return true;
        }
        MODES.iter().any(|(flag, mode)| {
            word.strip_prefix(flag)
                .and_then(|rest| rest.strip_prefix('='))
                .is_some_and(|value| value == *mode)
                || (word == flag && words.get(index + 1).is_some_and(|value| value == mode))
        })
    })
}

#[cfg(test)]
mod tests {
    use super::permissions_off;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| part.to_string()).collect()
    }

    #[test]
    fn restored_bypass_modes_are_seen_inside_shell_commands() {
        for command in [
            "claude --resume 'abc' --dangerously-skip-permissions",
            "codex resume abc --dangerously-bypass-approvals-and-sandbox",
            "gemini --resume abc --approval-mode yolo",
            "qwen --resume abc -y",
            "cursor-agent --resume abc --force",
            "grok --resume abc --permission-mode bypassPermissions",
            "claude --permission-mode=bypassPermissions",
            "codex resume abc -a never",
            "copilot --resume abc --allow-all-tools",
        ] {
            assert!(
                permissions_off(&argv(&["-NoExit", "-Command", command])),
                "{command}"
            );
        }
    }

    #[test]
    fn ordinary_launches_and_unrelated_flags_are_not_marked() {
        for command in [
            "claude --resume abc --permission-mode plan",
            "gemini --approval-mode default",
            "git push --force",
            "npm init -y",
            "codex resume abc",
            "codex -a on-request",
        ] {
            assert!(!permissions_off(&argv(&["-c", command])), "{command}");
        }
        assert!(!permissions_off(&[]));
    }
}
