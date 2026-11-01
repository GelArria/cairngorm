import { catchLog } from "@/debug/data/safe";
import { restoreWorkspaceProcesses } from "../data/session-launch";
import { debugLog } from "../data/terminal-debug-logger";
import { emitTerminalEvent } from "../data/terminal-events";
import { loadWorkspace, saveWorkspace, workspaceCounter } from "../data/workspace-storage";
import { activeInline } from "../model/layout/geometry";
import { paintGroups } from "../model/layout/group-colors";
import { normalizeLayout } from "../model/layout/normalize";
import { reconcileSplits } from "../model/layout/split-groups";
import { sameTerminalChrome } from "../model/terminal-chrome";
import { type TerminalState, type TermTab } from "../model/types";
import { setNextId } from "./id-counter";

const INIT: TerminalState = {
  tabs: [],
  layout: null,
  activeTabId: null,
  groups: [{ id: "g1", name: "Group 1" }],
  activeGroupId: "g1",
  savedLayouts: {},
};

export type Listener = (s: TerminalState) => void;

export const listeners = new Set<Listener>();

export let currentState: TerminalState = { ...INIT };

let persistWorkspace = false;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Main window only, before projects synchronize or terminals mount. */
export function startWorkspacePersistence() {
  if (persistWorkspace) {
    return;
  }
  const restored = loadWorkspace();
  if (restored) {
    currentState = restored;
    setNextId(workspaceCounter(restored));
    currentState.layout = normalizeLayout(
      activeInline(restored.tabs, restored.activeGroupId),
      restored.layout,
    );
    for (const id of Object.keys(restored.savedLayouts)) {
      currentState.savedLayouts[id] = normalizeLayout(
        activeInline(restored.tabs, id),
        restored.savedLayouts[id],
      );
    }
    currentState.parkedLayouts = restored.parkedLayouts?.filter((l) => l?.cells?.length);
    currentState = reconcileSplits(currentState);
    currentState = paintGroups(currentState, currentState);
    void restoreWorkspaceProcesses(currentState.tabs);
  }
  persistWorkspace = true;
  const flush = () => {
    window.dispatchEvent(new Event("terminal-save-scrollback"));
    saveWorkspace(currentState);
  };
  window.addEventListener("beforeunload", flush);
  window.addEventListener("terminal-persist-flush", flush);
}

function notify() {
  listeners.forEach((l) => l(currentState));
}

export function setState(next: TerminalState | ((prev: TerminalState) => TerminalState)) {
  const raw = typeof next === "function" ? next(currentState) : next;
  const value = raw === currentState ? raw : paintGroups(reconcileSplits(raw), currentState);
  if (value === currentState) {
    return;
  }
  const chromeChanged = !sameTerminalChrome(currentState, value);
  currentState = value;
  if (persistWorkspace) {
    clearTimeout(saveTimer);
    // Layout/focus/close are durable immediately; draft typing is debounced.
    if (chromeChanged) {
      saveWorkspace(currentState);
    } else {
      saveTimer = setTimeout(() => saveWorkspace(currentState), 400);
    }
  }
  debugLog(
    "state",
    "setState",
    `active=${currentState.activeTabId} tabs=${currentState.tabs.map((t) => `${t.id}(${t.title},${t.detached ? "det" : "in"})`).join(",")} layout=${currentState.layout ? currentState.layout.cells.length + "cells" : "none"}`,
  );
  notify();
  const detachedId = new URLSearchParams(window.location.search).get("detached");
  if (detachedId) {
    const members = currentState.tabs.map(({ shellEnv: _env, ...tab }) => tab);
    emitTerminalEvent("terminal-detached-state", {
      windowLabel: `detached-${detachedId}`,
      members,
      layout: currentState.layout,
      activeTabId: currentState.activeTabId,
    }).catch(catchLog("terminal"));
  }
}

/** Read current content at action time; chrome snapshots deliberately skip typing updates. */
export function getTerminalTab(id: string | null = currentState.activeTabId): TermTab | undefined {
  return currentState.tabs.find((t) => t.id === id);
}

export function getTerminalTabs(): TermTab[] {
  return currentState.tabs;
}
