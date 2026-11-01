//! Repository config that makes Git run commands. Git runs `core.fsmonitor` hooks, filter
//! drivers and diff drivers while it only reads status or history, so a folder that carries its
//! own hostile `.git/config` (an extracted archive, a shared drive) would run code as soon as
//! Cairngorm shows it. A clone never copies `.git/config`; this guards folders that arrive
//! some other way. Settings Git lets the command line override are forced in `spawn_git`
//! (`OVERRIDES`); this check refuses the drivers that no command-line option can disable.
//! Only the repository's own scopes are checked: global and system config belong to the user.
//! Keys that run only on operations the user starts (sshCommand, credential.helper, signing on
//! commit) stay allowed, as in a terminal: refusing them would break common setups.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

/// Command-line settings beat repository config: no fsmonitor command, no signature check
/// (gpg.program) when history is listed.
pub(crate) const OVERRIDES: &[&str] = &[
    "-c",
    "core.fsmonitor=false",
    "-c",
    "log.showSignature=false",
];

/// Values `git lfs install --local` writes (current, --skip-smudge and legacy forms); they run
/// the user's own git-lfs, not repository code.
const LFS: &[(&str, &str)] = &[
    ("filter.lfs.clean", "git-lfs clean -- %f"),
    ("filter.lfs.smudge", "git-lfs smudge -- %f"),
    ("filter.lfs.smudge", "git-lfs smudge --skip -- %f"),
    ("filter.lfs.process", "git-lfs filter-process"),
    ("filter.lfs.process", "git-lfs filter-process --skip"),
    ("filter.lfs.clean", "git-lfs clean %f"),
    ("filter.lfs.smudge", "git-lfs smudge %f"),
];

/// A checked repository stays trusted this long unless its config file changes; includes can
/// point at other files, so the result is not kept indefinitely.
const CACHE_FOR: Duration = Duration::from_secs(5);

type Stamp = Option<(Option<SystemTime>, Option<SystemTime>)>;
static CHECKED: Mutex<Option<HashMap<PathBuf, (Instant, Stamp, Result<(), String>)>>> =
    Mutex::new(None);

/// `core.fsmonitor` as a Git boolean selects the built-in daemon; anything else is a command.
/// Git does not trim a quoted value, so " true" is a command and is treated as one here.
fn is_boolean(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "" | "true" | "false" | "yes" | "no" | "on" | "off"
    ) || value.parse::<i64>().is_ok()
}

/// Whether one repository-scoped entry would make Git run a command during reads or diffs.
fn runs_command(key: &str, value: &str) -> bool {
    // Section and variable names are case-insensitive; the subsection (driver name) is not.
    let lower = key.to_ascii_lowercase();
    if lower == "core.fsmonitor" {
        return !is_boolean(value);
    }
    if lower == "diff.external" {
        return true;
    }
    let driver_key = |section: &str, names: &[&str]| {
        lower.starts_with(section) && names.iter().any(|n| lower.ends_with(n))
    };
    if driver_key("filter.", &[".clean", ".smudge", ".process"]) {
        return !LFS.iter().any(|(k, v)| lower == *k && value == *v);
    }
    driver_key("diff.", &[".textconv", ".command"])
}

/// The first repository-scoped key that runs a command, from
/// `git config --list --show-scope --includes -z` output (`scope\0key\nvalue\0`).
pub(crate) fn command_key(listing: &str) -> Option<String> {
    let mut fields = listing.split('\0');
    while let (Some(scope), Some(entry)) = (fields.next(), fields.next()) {
        if scope != "local" && scope != "worktree" {
            continue;
        }
        let (key, value) = entry.split_once('\n').unwrap_or((entry, ""));
        if runs_command(key, value) {
            return Some(key.to_string());
        }
    }
    None
}

/// Modification times of the repository's own config files; `None` when `.git` is a file
/// (linked worktree, submodule checkout), whose config lives elsewhere: never cached.
fn stamp(repo: &Path) -> Stamp {
    let dir = repo.join(".git");
    if !dir.is_dir() {
        return None;
    }
    let modified = |name: &str| {
        std::fs::metadata(dir.join(name))
            .and_then(|m| m.modified())
            .ok()
    };
    Some((modified("config"), modified("config.worktree")))
}

fn read(repo: &Path) -> Result<(), String> {
    let mut c = Command::new("git");
    c.arg("-C")
        .arg(repo)
        .args(["config", "--list", "--show-scope", "--includes", "-z"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    // Git missing: the real command reports "git spawn failed" exactly as before.
    let Ok(out) = c.output() else {
        return Ok(());
    };
    if !out.status.success() {
        // Unreadable config, or Git older than 2.26 (no --show-scope): fail closed.
        let reason = String::from_utf8_lossy(&out.stderr);
        let reason = reason.lines().next().unwrap_or("unknown error");
        return Err(format!(
            "Cairngorm could not check this repository's Git configuration ({reason}). \
             Git 2.26 or newer is required."
        ));
    }
    match command_key(&String::from_utf8_lossy(&out.stdout)) {
        Some(key) if key.to_ascii_lowercase().starts_with("filter.lfs.") => Err(format!(
            "Cairngorm does not run Git in this folder: `{key}` is not a recognised Git LFS command. \
             Run `git lfs install --local` again, or use Git in a terminal if you trust this repository."
        )),
        Some(key) => Err(format!(
            "Cairngorm does not run Git in this folder: its repository config sets `{key}`, which \
             runs a command. Remove that setting, or use Git in a terminal if you trust this repository."
        )),
        None => Ok(()),
    }
}

/// Refuses to run Git in `repo` when its own config would execute a command. Reading config
/// executes nothing. Called under the Git lock for every Git call; cached briefly per repo.
pub(crate) fn check(repo: &Path) -> Result<(), String> {
    let now = Instant::now();
    let current = stamp(repo);
    let mut cache = CHECKED.lock().unwrap_or_else(|e| e.into_inner());
    let cache = cache.get_or_insert_with(HashMap::new);
    if let Some((at, seen, result)) = cache.get(repo) {
        if current.is_some() && *seen == current && now.duration_since(*at) < CACHE_FOR {
            return result.clone();
        }
    }
    let result = read(repo);
    if current.is_some() {
        cache.insert(repo.to_path_buf(), (now, current, result.clone()));
    }
    result
}

/// Submodules run Git with their own config, which the check above does not see: status and
/// diff skip them (`--ignore-submodules=all` also beats a local `submodule.*.ignore`).
pub(crate) fn with_submodules_ignored<'a>(args: &[&'a str]) -> Vec<&'a str> {
    let mut out: Vec<&str> = args.to_vec();
    // Skip leading `-c key=value` pairs to find the subcommand.
    let mut i = 0;
    while i + 1 < out.len() && out[i] == "-c" {
        i += 2;
    }
    let reads_submodules = matches!(out.get(i), Some(&"status") | Some(&"diff"));
    if reads_submodules && !out.iter().any(|a| a.starts_with("--ignore-submodules")) {
        out.insert(i + 1, "--ignore-submodules=all");
    }
    out
}

#[cfg(test)]
#[path = "../../../../tests/native/git-config-guard.rs"]
mod tests;
