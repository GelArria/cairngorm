// Workspace search commands. The command returns at once; file discovery
// (search_walk) and matching (search_scan, rayon) run on a worker thread that
// streams results as "search-results-batch" events. The frontend picks the
// batch id up front, so no early batch can arrive before it is listening.
use crate::search_filter::PathFilter;
use crate::search_scan::{build_regex, read_text, scan_file, SearchMatch};
use crate::search_walk::{self, MAX_FILE_SIZE};
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_RESULTS: usize = 5000;
const BATCH_SIZE: usize = 250;
const BATCH_MAX_AGE: Duration = Duration::from_millis(60);

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SearchBatchPayload {
    batch_id: String,
    matches: Vec<SearchMatch>,
    done: bool,
}

lazy_static::lazy_static! {
    static ref CANCEL_FLAGS: Mutex<HashMap<String, Arc<AtomicBool>>> = Mutex::new(HashMap::new());
}

fn filtered_files(root: &Path, filter: &PathFilter) -> Arc<Vec<PathBuf>> {
    let files = search_walk::files_for(root);
    if filter.is_noop() {
        return files;
    }
    Arc::new(
        files
            .iter()
            .filter(|p| filter.accepts(root, p))
            .cloned()
            .collect(),
    )
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn fs_search_files(
    app: tauri::AppHandle,
    root: String,
    query: String,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
    include_pattern: Option<String>,
    exclude_pattern: Option<String>,
    context_lines: Option<usize>,
    batch_id: Option<String>,
) -> Result<String, String> {
    if query.is_empty() {
        return Err("Empty query".into());
    }
    let re = Arc::new(build_regex(&query, case_sensitive, whole_word, use_regex)?);
    let filter = PathFilter::new(
        include_pattern.as_deref().unwrap_or(""),
        exclude_pattern.as_deref().unwrap_or(""),
    )?;
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }
    let ctx_lines = context_lines.unwrap_or(0);

    let batch_id = batch_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    // a cancel for this id may already be in (it can overtake the search command)
    let cancel = CANCEL_FLAGS
        .lock()
        .unwrap()
        .entry(batch_id.clone())
        .or_default()
        .clone();

    let bid = batch_id.clone();
    std::thread::spawn(move || {
        let emit_batch = |matches: Vec<SearchMatch>, done: bool| {
            crate::emit_safe::emit_bg(
                &app,
                "search-results-batch",
                SearchBatchPayload {
                    batch_id: bid.clone(),
                    matches,
                    done,
                },
            );
        };
        // superseded before it started (the next keystroke) → skip the work
        let files = if cancel.load(Ordering::Relaxed) {
            Arc::new(Vec::new())
        } else {
            filtered_files(&root_path, &filter)
        };
        let (tx, rx) = crossbeam_channel::unbounded::<Vec<SearchMatch>>();

        // Producer: rayon over files → one message per file with hits
        let (p_cancel, p_re) = (cancel.clone(), re.clone());
        std::thread::spawn(move || {
            files.par_iter().for_each_with(tx, |tx, path| {
                if p_cancel.load(Ordering::Relaxed) {
                    return;
                }
                if let Some(text) = read_text(path, MAX_FILE_SIZE) {
                    let hits = scan_file(path, &text, &p_re, &p_cancel, ctx_lines);
                    if !hits.is_empty() {
                        let _ = tx.send(hits);
                    }
                }
            });
        });

        // Consumer: coalesce into batches (size or age)
        let mut batch: Vec<SearchMatch> = Vec::with_capacity(BATCH_SIZE);
        let (mut total, mut last_emit) = (0usize, Instant::now());
        loop {
            let finished = match rx.recv_timeout(Duration::from_millis(30)) {
                Ok(hits) => {
                    let room = MAX_RESULTS - total - batch.len();
                    batch.extend(hits.into_iter().take(room));
                    false
                }
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => false,
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => true,
            };
            let full = total + batch.len() >= MAX_RESULTS;
            if !batch.is_empty()
                && (finished
                    || full
                    || batch.len() >= BATCH_SIZE
                    || last_emit.elapsed() >= BATCH_MAX_AGE)
            {
                total += batch.len();
                emit_batch(std::mem::take(&mut batch), false);
                last_emit = Instant::now();
            }
            if full {
                cancel.store(true, Ordering::Relaxed);
            }
            if finished || full || cancel.load(Ordering::Relaxed) {
                break;
            }
        }
        emit_batch(Vec::new(), true);
        CANCEL_FLAGS.lock().unwrap().remove(&bid);
    });

    Ok(batch_id)
}

#[tauri::command]
pub fn fs_search_cancel(batch_id: String) -> Result<(), String> {
    let mut flags = CANCEL_FLAGS.lock().unwrap();
    // cancels of finished runs leave a flag behind: drop those once a few pile up
    if flags.len() > 64 {
        flags.retain(|_, f| !f.load(Ordering::Relaxed));
    }
    flags
        .entry(batch_id)
        .or_default()
        .store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn fs_refresh_search_index(root: String) -> Result<usize, String> {
    crate::blocking(move || refresh_index(root)).await?
}

fn refresh_index(root: String) -> Result<usize, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {}", root));
    }
    Ok(search_walk::files_for(root_path).len())
}
