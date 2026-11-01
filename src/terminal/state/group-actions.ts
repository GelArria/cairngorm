import { finalizeLayout } from "../model/layout/finalize";
import { activeInline } from "../model/layout/geometry";
import { normalizeLayout } from "../model/layout/normalize";
import { type TermGroup, type TerminalState } from "../model/types";
import { closeTabNow } from "./tab-actions";
import { currentState, setState } from "./terminal-store";

// ── Project groups ─────────────────────────────────────────────────────
// The projects store owns the group list (syncProjectGroups); this store only
// keeps each project's tabs + grid and swaps grids on switch.

function switchGroupState(prev: TerminalState, id: string): TerminalState {
  if (id === prev.activeGroupId || !prev.groups.some((g) => g.id === id)) {
    return prev;
  }
  // Save the outgoing group layout and restore the incoming one
  const savedLayouts = { ...prev.savedLayouts, [prev.activeGroupId]: prev.layout };
  // Re-normalize: tabs of this project may have closed while it was in the background
  const restored = normalizeLayout(activeInline(prev.tabs, id), savedLayouts[id] ?? null);
  const layout = restored ? finalizeLayout(restored) : null;
  const rest = { ...savedLayouts };
  delete rest[id];
  const firstTab = activeInline(prev.tabs, id)[0] ?? prev.tabs.find((t) => t.groupId === id);
  return {
    ...prev,
    activeGroupId: id,
    layout,
    savedLayouts: rest,
    // The restored split group stays on screen: focus one of its panes
    activeTabId: layout?.cells[0]?.tabId ?? firstTab?.id ?? null,
  };
}

export function switchGroup(id: string) {
  setState((prev) => switchGroupState(prev, id));
}

const sameGroups = (a: TermGroup[], b: TermGroup[]) =>
  a.length === b.length &&
  a.every(
    (g, i) =>
      g.id === b[i].id && g.name === b[i].name && g.color === b[i].color && g.cwd === b[i].cwd,
  );

/** Mirror the projects list: one group per project, `activeId` in the grid.
 *  Tabs whose group no longer exists (startup default, removed project) move
 *  into the active project. */
export function syncProjectGroups(groups: TermGroup[], activeId: string) {
  if (!groups.some((g) => g.id === activeId)) {
    return;
  }
  const ids = new Set(groups.map((g) => g.id));
  const s = currentState;
  const orphans = s.tabs.some((t) => !ids.has(t.groupId ?? "g1"));
  if (!orphans && sameGroups(s.groups, groups) && s.activeGroupId === activeId) {
    return;
  }
  setState((prev) => {
    const tabs = orphans
      ? prev.tabs.map((t) => (ids.has(t.groupId ?? "g1") ? t : { ...t, groupId: activeId }))
      : prev.tabs;
    const savedLayouts = Object.fromEntries(
      Object.entries(prev.savedLayouts).filter(([k]) => ids.has(k)),
    );
    const next: TerminalState = { ...prev, tabs, groups, savedLayouts };
    if (ids.has(prev.activeGroupId)) {
      return switchGroupState(next, activeId);
    }
    // The displayed group vanished. Startup ("g1"): its tabs AND grid move into
    // activeId. Removed project: its tabs are gone → restore activeId's own grid.
    const base = savedLayouts[activeId] ?? (orphans ? prev.layout : null);
    const norm = normalizeLayout(activeInline(tabs, activeId), base);
    const layout = norm ? finalizeLayout(norm) : null;
    delete savedLayouts[activeId];
    const inline = activeInline(tabs, activeId);
    const activeTabId = inline.some((t) => t.id === prev.activeTabId)
      ? prev.activeTabId
      : (inline[0]?.id ?? null);
    return { ...next, activeGroupId: activeId, layout, activeTabId };
  });
}

/** Closes every terminal / file tab of a project (the project itself stays). */
export function closeGroup(id: string) {
  const ids = currentState.tabs.filter((t) => t.groupId === id).map((t) => t.id);
  for (const tid of ids) {
    closeTabNow(tid);
  } // Project removal already has its own confirmation.
}
