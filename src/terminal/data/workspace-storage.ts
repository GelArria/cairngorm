import type { TerminalState, TermTab, TileLayout } from "../model/types";
import { initializeScrollbackPolicy } from "../runtime/scrollback-policy";
import {
  flushStorage,
  initializeStorage,
  nativeStorageAvailable,
  peekStored,
  writeStored,
} from "./native-storage";

export async function initializeWorkspaceStorage() {
  await initializeStorage(WORKSPACE_KEY);
  await initializeScrollbackPolicy();
  const restored = loadWorkspace();
  if (nativeStorageAvailable() && restored) {
    saveWorkspace(restored);
    await flushStorage();
  }
}

export const WORKSPACE_KEY = "cairngorm-terminal-workspace-v1";
// Detached webviews share localStorage. Only main owns the workspace snapshot.
const isMain = () => {
  const params = new URLSearchParams(window.location.search);
  return !params.has("detached") && !params.has("document");
};
const safeEnv = new Set(["TERM", "MSYS", "LANG", "HOME"]);

function snapshot(state: TerminalState): TerminalState {
  const active = state.tabs.find((t) => t.id === state.activeTabId);
  // Live observations belong to this app session, not the restored workspace.
  return {
    ...state,
    activeTabId:
      active?.kind === "tests"
        ? (active.testSourceTabId ?? null)
        : active?.kind === "plugin"
          ? (active.pluginSourceTabId ?? null)
          : active?.kind === "app"
            ? (active.appSourceTabId ?? null)
            : state.activeTabId,
    tabs: state.tabs
      .filter((t) => t.kind !== "tests" && t.kind !== "plugin" && t.kind !== "app")
      .map(({ shellEnv, imageSrc, binarySrc, documentTicket: _ticket, ...tab }) => ({
        ...tab,
        // Never persist resolved credentials (native sidecar re-resolves them).
        shellEnv: tab.isAgent
          ? undefined
          : shellEnv &&
            Object.fromEntries(Object.entries(shellEnv).filter(([k]) => safeEnv.has(k))),
        imageSrc: tab.isImage && !tab.fullPath ? imageSrc : undefined,
        // Dropped documents can be tens of MiB: they are shown, never written to the workspace.
        binarySrc: tab.fullPath || tab.document ? undefined : binarySrc,
      })),
  };
}

export function saveWorkspace(state: TerminalState): void {
  if (!isMain()) {
    return;
  }
  try {
    const safe = snapshot(state);
    writeStored(WORKSPACE_KEY, () => JSON.stringify({ version: 1, state: safe }));
  } catch (err) {
    console.error("[workspace] could not save terminal workspace", err);
  }
}

function validLayout(value: unknown): value is TileLayout | null {
  if (value === null) {
    return true;
  }
  const l = value as TileLayout;
  return (
    !!l &&
    Number.isInteger(l.columnCount) &&
    l.columnCount > 0 &&
    Array.isArray(l.columnRatios) &&
    l.columnRatios.length === l.columnCount &&
    l.columnRatios.every((n) => Number.isFinite(n) && n > 0) &&
    (l.rowRatios === undefined ||
      (Array.isArray(l.rowRatios) && l.rowRatios.every((n) => Number.isFinite(n) && n > 0))) &&
    Array.isArray(l.cells) &&
    l.cells.every(
      (c) =>
        typeof c.id === "string" &&
        typeof c.tabId === "string" &&
        [c.col, c.row].every((n) => Number.isInteger(n) && n >= 0) &&
        [c.colSpan, c.rowSpan].every((n) => Number.isInteger(n) && n > 0),
    )
  );
}

export function loadWorkspace(): TerminalState | null {
  if (!isMain()) {
    return null;
  }
  try {
    const raw = peekStored(WORKSPACE_KEY);
    if (!raw) {
      return null;
    }
    const { version, state: s } = JSON.parse(raw);
    if (
      version !== 1 ||
      !s ||
      !Array.isArray(s.tabs) ||
      !Array.isArray(s.groups) ||
      !s.groups.length ||
      !s.groups.every(
        (g: { id: unknown; name: unknown }) =>
          typeof g?.id === "string" && typeof g.name === "string",
      ) ||
      !s.groups.some((g: { id: string }) => g.id === s.activeGroupId) ||
      !validLayout(s.layout) ||
      !s.savedLayouts ||
      !Object.values(s.savedLayouts).every(validLayout) ||
      (s.detachedLayouts &&
        !Object.values(s.detachedLayouts).every(
          (d: any) => typeof d.groupId === "string" && validLayout(d.layout),
        )) ||
      !s.tabs.every(
        (t: TermTab) =>
          typeof t?.id === "string" &&
          typeof t.sessionId === "string" &&
          typeof t.title === "string",
      ) ||
      new Set(s.tabs.map((t: TermTab) => t.id)).size !== s.tabs.length ||
      new Set(s.tabs.map((t: TermTab) => t.sessionId)).size !== s.tabs.length
    ) {
      return null;
    }
    // Recovered detached terminals join main; no stale window labels survive.
    const recovered: TerminalState = {
      ...s,
      savedLayouts: { ...s.savedLayouts },
      parkedLayouts: Array.isArray(s.parkedLayouts)
        ? s.parkedLayouts.filter((l: unknown) => l !== null && validLayout(l))
        : undefined,
      detachedLayouts: {},
      tabs: s.tabs.map((t: TermTab) => ({
        ...t,
        openedAt: Number.isFinite(t.openedAt) ? t.openedAt : Date.now(),
        detached: false,
        detachedWindowLabel: undefined,
        status: "running",
      })),
    };
    for (const [label, detached] of Object.entries(s.detachedLayouts ?? {}) as [
      string,
      { groupId: string; layout: TileLayout | null; activeTabId: string | null },
    ][]) {
      const ids = new Set<string>(
        s.tabs
          .filter((t: TermTab) => t.detached && t.detachedWindowLabel === label)
          .map((t: TermTab) => t.id),
      );
      if (!ids.size) {
        continue;
      }
      // The window's grid returns as its own (parked) split group; a lone tab returns loose.
      const cells = detached.layout?.cells.filter((c) => ids.has(c.tabId)) ?? [];
      if (cells.length >= 2) {
        recovered.parkedLayouts = [
          ...(recovered.parkedLayouts ?? []),
          { ...detached.layout!, cells },
        ];
      }
      if (
        detached.groupId === recovered.activeGroupId &&
        !recovered.activeTabId &&
        detached.activeTabId &&
        ids.has(detached.activeTabId)
      ) {
        recovered.activeTabId = detached.activeTabId;
      }
    }
    return recovered;
  } catch (err) {
    console.error("[workspace] could not load terminal workspace", err);
    return null;
  }
}

export function workspaceCounter(s: TerminalState): number {
  const ids = [
    ...s.tabs.map((t) => t.id),
    ...(s.layout?.cells.map((c) => c.id) ?? []),
    ...Object.values(s.savedLayouts).flatMap((l) => l?.cells.map((c) => c.id) ?? []),
    ...(s.parkedLayouts ?? []).flatMap((l) => l.cells.map((c) => c.id)),
  ];
  return ids.reduce((max, id) => Math.max(max, /^\d+$/.test(id) ? Number(id) : 0), 0);
}
