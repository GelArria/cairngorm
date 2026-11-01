//! The files a scheduled run changed, so its result can be reviewed beside them. Git projects
//! only: the working tree's status and each listed file's modification time are taken before
//! and after the run, and every path whose state differs is reported. Ignored files are not
//! seen, a change undone within the same run leaves no trace, and an untracked folder is one
//! entry (bounded cost on large trees; a file added deep inside it may go unnoticed).
use std::{collections::BTreeMap, path::Path, time::SystemTime};

const LIMIT: usize = 200;

/// Path (relative to the repository) -> status code and modification time.
pub type Snapshot = BTreeMap<String, (String, Option<SystemTime>)>;

pub fn snapshot(root: &Path) -> Option<Snapshot> {
    let top = crate::git::git(root, &["rev-parse", "--show-toplevel"]).ok()?;
    let top = Path::new(top.trim());
    let status = crate::git::git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    )
    .ok()?;
    let mut files = Snapshot::new();
    let mut entries = status.split('\0');
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let (code, path) = (entry[..2].to_string(), &entry[3..]);
        if code.starts_with('R') || code.starts_with('C') {
            // The original path of a rename or copy follows as its own entry.
            entries.next();
        }
        let modified = std::fs::metadata(top.join(path))
            .and_then(|meta| meta.modified())
            .ok();
        files.insert(path.to_string(), (code, modified));
    }
    Some(files)
}

/// "<status> <path>" for every path whose state differs; "-- <path>" when a run made a
/// changed file clean again. Long lists end with a count of the rest.
pub fn changes(before: &Snapshot, after: &Snapshot) -> Vec<String> {
    let mut changed: Vec<String> = after
        .iter()
        .filter(|(path, state)| before.get(*path) != Some(state))
        .map(|(path, (code, _))| format!("{} {path}", code.trim()))
        .chain(
            before
                .keys()
                .filter(|path| !after.contains_key(*path))
                .map(|path| format!("-- {path}")),
        )
        .collect();
    changed.sort_by(|a, b| {
        a.split_once(' ')
            .map(|x| x.1)
            .cmp(&b.split_once(' ').map(|x| x.1))
    });
    if changed.len() > LIMIT {
        let rest = changed.len() - LIMIT;
        changed.truncate(LIMIT);
        changed.push(format!("… and {rest} more"));
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(entries: &[(&str, &str, u64)]) -> Snapshot {
        entries
            .iter()
            .map(|(path, code, secs)| {
                let time = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(*secs);
                (path.to_string(), (code.to_string(), Some(time)))
            })
            .collect()
    }

    #[test]
    fn lists_new_touched_and_cleaned_paths_only() {
        let before = state(&[("a.txt", " M", 1), ("b.txt", " M", 1), ("c.txt", " M", 1)]);
        let after = state(&[("a.txt", " M", 1), ("b.txt", " M", 2), ("d.txt", "??", 2)]);
        assert_eq!(
            changes(&before, &after),
            vec!["M b.txt", "-- c.txt", "?? d.txt"]
        );
        assert!(changes(&after, &after).is_empty());
    }

    #[test]
    fn long_lists_are_bounded() {
        let after: Snapshot = (0..250)
            .map(|n| (format!("f{n:03}"), ("??".to_string(), None)))
            .collect();
        let listed = changes(&Snapshot::new(), &after);
        assert_eq!(listed.len(), LIMIT + 1);
        assert_eq!(listed.last().unwrap(), "… and 50 more");
    }
}
