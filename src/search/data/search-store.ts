// Global search state (module singleton). One Rust search runs at a time; its
// results stream in as "search-results-batch" events that are buffered and
// applied at most once per FLUSH_MS, so thousands of hits cost a handful of
// renders instead of one per batch. The previous results stay on screen until
// the new run's first batch lands (no blank flash while typing).
import {
  cancelSearch,
  onSearchBatch,
  searchFiles,
  type SearchBatch,
  type SearchMatch,
} from "@/common/filesystem/fs-bridge";
import { getWorkspaceRootPath, setWorkspaceRootPath } from "@/common/filesystem/workspace-root";
import { catchLog } from "@/debug/data/safe";

export interface GlobalSearchState {
  isOpen: boolean;
  query: string;
  includePattern: string;
  excludePattern: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  results: SearchMatch[];
  loading: boolean;
  error: string | null;
  expandedFiles: Record<string, boolean>;
  currentBatchId: string | null;
}

type Listener = (s: GlobalSearchState) => void;
export const listeners = new Set<Listener>();

const MAX_RESULTS = 5000;
const CACHE_MAX = 30;
const FLUSH_MS = 32;

let currentState: GlobalSearchState = {
  isOpen: false,
  query: "",
  includePattern: "",
  excludePattern: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  results: [],
  loading: false,
  error: null,
  expandedFiles: {},
  currentBatchId: null,
};

export const getState = () => currentState;
export const getRootPath = getWorkspaceRootPath;
export const setRootPathValue = setWorkspaceRootPath;

export function set(next: GlobalSearchState | ((prev: GlobalSearchState) => GlobalSearchState)) {
  currentState = typeof next === "function" ? next(currentState) : next;
  listeners.forEach((l) => l(currentState));
}

// Finished result sets by query+options+root (LRU). Shown instantly on a repeat
// query while a fresh run confirms them.
const resultCache = new Map<string, SearchMatch[]>();
const cacheKey = (s: GlobalSearchState) =>
  `${getRootPath()}|${s.query}|${s.caseSensitive}|${s.wholeWord}|${s.useRegex}|${s.includePattern}|${s.excludePattern}`;

function remember(key: string, results: SearchMatch[]) {
  resultCache.delete(key);
  resultCache.set(key, results);
  if (resultCache.size > CACHE_MAX) {
    resultCache.delete(resultCache.keys().next().value!);
  }
}

// ── Streaming ─────────────────────────────────────────────────────────────
let pending: SearchMatch[] = [];
let pendingDone = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// The run builds its own list. Without a cache hit it is shown as it grows (the
// previous query's results stay up until its first batch lands); with one, the
// cached full list stays up until the run is done — no full → partial flicker.
let runResults: SearchMatch[] = [];
let holdCached = false;
let runCacheKey = "";

function resetStream() {
  pending = [];
  pendingDone = false;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function flush() {
  flushTimer = null;
  const incoming = pending,
    done = pendingDone;
  resetStream();
  if (incoming.length) {
    runResults = runResults.concat(incoming).slice(0, MAX_RESULTS);
  }
  const results = runResults;
  if (!done) {
    if (!holdCached) {
      set((prev) => ({ ...prev, results }));
    }
    return;
  }

  remember(runCacheKey, results);
  set((prev) => ({ ...prev, results, loading: false, currentBatchId: null }));
}

function handleSearchBatch(batch: SearchBatch) {
  if (batch.batchId !== currentState.currentBatchId) {
    return;
  } // stale run
  for (const m of batch.matches) {
    pending.push(m);
  }
  if (batch.done) {
    pendingDone = true;
    flush();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_MS);
  }
}

// Tauri event listeners — registered once, on first use, for the whole session
let listening: Promise<void> | null = null;

export function ensureListener(): Promise<void> {
  listening ??= (async () => {
    try {
      await onSearchBatch(handleSearchBatch);
    } catch (err) {
      listening = null;
      console.error("[search] failed to register event listener:", err);
    }
  })();
  return listening;
}

// ── Runs ──────────────────────────────────────────────────────────────────
let searchSeq = 0;

export function cancelCurrentSearch() {
  const bid = currentState.currentBatchId;
  resetStream();
  if (bid) {
    cancelSearch(bid).catch(catchLog("search"));
    set((prev) => ({ ...prev, currentBatchId: null }));
  }
}

export async function runSearch() {
  const seq = ++searchSeq;
  const s = currentState;
  cancelCurrentSearch();

  const root = getRootPath();
  const tooShort = s.query.length < (s.useRegex ? 1 : 2);
  if (!s.query || !root || tooShort) {
    const error = s.query && !root ? "No workspace folder open" : null;
    set((prev) => ({ ...prev, results: [], loading: false, error }));
    return;
  }

  await ensureListener();
  if (seq !== searchSeq) {
    return;
  }

  // The id is ours, set BEFORE the invoke: Rust can stream the first batch
  // before the invoke resolves, and it must not be dropped as "stale".
  const batchId = `s${seq}-${Date.now().toString(36)}`;
  runCacheKey = cacheKey(s);
  runResults = [];
  const cached = resultCache.get(runCacheKey);
  holdCached = !!cached;
  set((prev) => ({
    ...prev,
    results: cached ?? prev.results,
    loading: true,
    error: null,
    currentBatchId: batchId,
  }));

  try {
    await searchFiles(
      root,
      s.query,
      s.caseSensitive,
      s.wholeWord,
      s.useRegex,
      s.includePattern || undefined,
      s.excludePattern || undefined,
      0,
      batchId,
    );
  } catch (err) {
    if (seq !== searchSeq) {
      return;
    }
    resetStream();
    set((prev) => ({
      ...prev,
      results: [],
      loading: false,
      error: String(err),
      currentBatchId: null,
    }));
  }
}
