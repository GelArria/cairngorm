// File discovery for workspace search: a parallel, .gitignore-aware walk
// (ripgrep's `ignore` crate) kept as a per-root index.
// - One walk at a time (WALK): concurrent callers wait and reuse its result.
// - A generation counter marks the index dirty on any app-side file change,
//   even mid-walk, so a search never sees a list older than the last change.
// - Older than INDEX_TTL → re-walked on the next search (catches changes made
//   outside the app: terminal, agents, git checkout). Walks run on worker threads.
use ignore::{WalkBuilder, WalkState};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".cache",
    "vendor",
    ".tox",
    "AppData",
    "Microsoft",
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "System Volume Information",
    "$RECYCLE.BIN",
    ".vscode",
    ".rustup",
    ".cargo",
    ".nuget",
    ".gradle",
    ".android",
    ".docker",
    ".conda",
    "miniconda3",
    "anaconda3",
    "build",
    "out",
    "bin",
    "obj",
    ".nuxt",
    ".svelte-kit",
];

const BINARY_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "ico", "avif", "svg", "mp3", "wav", "ogg", "flac",
    "aac", "mp4", "avi", "mkv", "mov", "webm", "zip", "tar", "gz", "bz2", "7z", "rar", "exe",
    "dll", "so", "dylib", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "woff", "woff2",
    "ttf", "otf", "eot", "sqlite", "db", "lock", "map", "wasm", "cur", "tff", "pyc", "pyo", "o",
    "a", "lib", "pdb", "exp", "ilk", "ncb", "suo", "idb",
];

pub const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;
const MAX_DEPTH: usize = 15;
/// Files kept in the index (the shallowest ones when a root has more).
const MAX_FILES: usize = 20_000;
/// Files the walk may visit before trimming to MAX_FILES — keeps the kept set
/// deterministic for any root below this size, despite the parallel walk order.
const WALK_CAP: usize = 100_000;
const INDEX_TTL_SECS: u64 = 30;

struct FileIndex {
    root: PathBuf,
    files: Arc<Vec<PathBuf>>,
    built: Instant,
    gen: u64,
}

lazy_static::lazy_static! {
    static ref SKIP_SET: HashSet<&'static str> = SKIP_DIRS.iter().copied().collect();
    static ref BINARY_SET: HashSet<&'static str> = BINARY_EXTS.iter().copied().collect();
    static ref INDEX: Mutex<Option<FileIndex>> = Mutex::new(None);
    static ref WALK: Mutex<()> = Mutex::new(());
}
static GEN: AtomicU64 = AtomicU64::new(0);

fn is_binary_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| BINARY_SET.contains(e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_SET.contains(name)
}

/// Every searchable file under `root`, sorted. Parallel; honours .gitignore inside repos.
pub fn walk(root: &Path) -> Vec<PathBuf> {
    let (tx, rx) = crossbeam_channel::unbounded::<PathBuf>();
    let count = AtomicUsize::new(0);
    WalkBuilder::new(root)
        .hidden(false) // dot-files are searchable; dot-dirs are cut by skip_dir
        .git_global(false)
        .max_depth(Some(MAX_DEPTH))
        .max_filesize(Some(MAX_FILE_SIZE))
        .filter_entry(|e| {
            e.depth() == 0
                || !e.file_type().map_or(false, |t| t.is_dir())
                || !skip_dir(&e.file_name().to_string_lossy())
        })
        .build_parallel()
        .run(|| {
            let (tx, count) = (tx.clone(), &count);
            Box::new(move |res| {
                let Ok(entry) = res else {
                    return WalkState::Continue;
                };
                if !entry.file_type().map_or(false, |t| t.is_file()) || is_binary_ext(entry.path())
                {
                    return WalkState::Continue;
                }
                if count.fetch_add(1, Ordering::Relaxed) >= WALK_CAP {
                    return WalkState::Quit;
                }
                let _ = tx.send(entry.into_path());
                WalkState::Continue
            })
        });
    drop(tx);
    let mut files: Vec<PathBuf> = rx.into_iter().take(WALK_CAP).collect();
    if files.len() > MAX_FILES {
        files.sort_by_cached_key(|p| (p.components().count(), p.clone()));
        files.truncate(MAX_FILES);
    }
    files.sort_unstable();
    files
}

/// The index for `root` when it is current (same root, no change since, young enough).
fn current(root: &Path) -> Option<Arc<Vec<PathBuf>>> {
    INDEX
        .lock()
        .unwrap()
        .as_ref()
        .filter(|i| {
            i.root == root
                && i.gen == GEN.load(Ordering::Acquire)
                && i.built.elapsed().as_secs() < INDEX_TTL_SECS
        })
        .map(|i| i.files.clone())
}

/// Indexed files for `root` — cached when current, else walked now (once, shared).
pub fn files_for(root: &Path) -> Arc<Vec<PathBuf>> {
    if let Some(files) = current(root) {
        return files;
    }
    let _walk = WALK.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(files) = current(root) {
        return files;
    } // a walk we waited on just made it
    let gen = GEN.load(Ordering::Acquire); // read BEFORE walking: a change mid-walk stays dirty
    let files = Arc::new(walk(root));
    *INDEX.lock().unwrap() = Some(FileIndex {
        root: root.to_path_buf(),
        files: files.clone(),
        built: Instant::now(),
        gen,
    });
    files
}

/// A file was created / renamed / deleted: mark the index dirty and re-walk the
/// current root off-thread, so the next search usually finds it ready.
pub fn refresh_in_background() {
    GEN.fetch_add(1, Ordering::AcqRel);
    let Some(root) = INDEX.lock().unwrap().as_ref().map(|i| i.root.clone()) else {
        return;
    };
    std::thread::spawn(move || {
        files_for(&root);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_tracks_changes_made_after_it_was_built() {
        let dir = std::env::temp_dir().join(format!("cg-walk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        assert_eq!(files_for(&dir).len(), 1);
        std::fs::write(dir.join("b.txt"), "b").unwrap();
        refresh_in_background(); // what fs_write_file / fs_ops do after a change
        assert_eq!(files_for(&dir).len(), 2); // never the stale list, even if the refresh hasn't run
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
