import { refreshSearchIndex } from "@/common/filesystem/fs-bridge";
import { catchLog } from "@/debug/data/safe";
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  cancelCurrentSearch,
  ensureListener,
  getRootPath,
  getState,
  listeners,
  runSearch,
  set,
  setRootPathValue,
  type GlobalSearchState,
} from "../data/search-store";

export type { GlobalSearchState } from "../data/search-store";

let debounceRef: ReturnType<typeof setTimeout> | null = null;

export function getWorkspaceRootPath(): string | null {
  return getRootPath();
}

export function setGlobalSearchRootPath(path: string | null) {
  // Idempotent: two WorkspacePanel instances set the same root at startup —
  // without this, refreshSearchIndex (full workspace walk in Rust) fires twice.
  if (path === getRootPath()) {
    return;
  }
  setRootPathValue(path);
  if (path) {
    refreshSearchIndex(path).catch(catchLog("search"));
  }
}

function scheduleSearch() {
  if (debounceRef) {
    clearTimeout(debounceRef);
  }
  debounceRef = setTimeout(runSearch, getState().useRegex ? 300 : 150);
}

export function openGlobalSearch() {
  set((prev) => ({ ...prev, isOpen: true }));
  if (getState().query) {
    scheduleSearch();
  }
}

export function closeGlobalSearch() {
  cancelCurrentSearch();
  set((prev) => ({
    ...prev,
    isOpen: false,
    results: [],
    loading: false,
    expandedFiles: {},
    currentBatchId: null,
  }));
}

export function setGlobalSearchQuery(query: string) {
  set((prev) => ({ ...prev, query, isOpen: true }));
  scheduleSearch();
}
export function setGlobalSearchIncludePattern(includePattern: string) {
  set((prev) => ({ ...prev, includePattern }));
  scheduleSearch();
}
export function setGlobalSearchExcludePattern(excludePattern: string) {
  set((prev) => ({ ...prev, excludePattern }));
  scheduleSearch();
}
export function toggleGlobalCaseSensitive() {
  set((prev) => ({ ...prev, caseSensitive: !prev.caseSensitive }));
  scheduleSearch();
}
export function toggleGlobalWholeWord() {
  set((prev) => ({ ...prev, wholeWord: !prev.wholeWord }));
  scheduleSearch();
}
export function toggleGlobalRegex() {
  set((prev) => ({ ...prev, useRegex: !prev.useRegex }));
  scheduleSearch();
}
export function toggleFileExpand(path: string) {
  set((prev) => ({
    ...prev,
    expandedFiles: { ...prev.expandedFiles, [path]: !(prev.expandedFiles[path] ?? true) },
  }));
}

export function useGlobalSearch() {
  const [state, setState] = useState<GlobalSearchState>(getState);

  useEffect(() => {
    const l = (s: GlobalSearchState) => setState(s);
    listeners.add(l);
    // Re-sync: preact defers effects to rAF, so updates fired between first
    // render (state snapshot) and this subscription would be lost forever
    setState(getState());
    // Tauri listeners stay for the session: a run still streaming when the last
    // view unmounts must still reach "done", or `loading` would stick.
    ensureListener();
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef) {
        clearTimeout(debounceRef);
      }
    };
  }, []);

  return {
    state,
    open: useCallback(openGlobalSearch, []),
    close: useCallback(closeGlobalSearch, []),
    setQuery: useCallback(setGlobalSearchQuery, []),
    setIncludePattern: useCallback(setGlobalSearchIncludePattern, []),
    setExcludePattern: useCallback(setGlobalSearchExcludePattern, []),
    toggleCase: useCallback(toggleGlobalCaseSensitive, []),
    toggleWholeWord: useCallback(toggleGlobalWholeWord, []),
    toggleRegex: useCallback(toggleGlobalRegex, []),
    toggleFileExpand: useCallback(toggleFileExpand, []),
  };
}
