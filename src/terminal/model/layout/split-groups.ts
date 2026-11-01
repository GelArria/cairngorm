// Split groups: a project can hold several split groups plus loose tabs.
// `layout` is the group on screen, `parkedLayouts` the others. After every
// state change `reconcileSplits` keeps the model consistent:
//  - a tab belongs to at most one group; closed/detached tabs leave their group
//    and the survivors fill the space (a group of one dissolves);
//  - the group on screen is the one holding the active tab: selecting a loose
//    tab parks the shown group, selecting a parked member brings its group back.
import type { TerminalState, TermTab, TileLayout } from "../types";
import { normalizeLayout } from "./normalize";

export const inLayout = (l: TileLayout | null | undefined, id: string | null | undefined) =>
  !!l && !!id && l.cells.some((c) => c.tabId === id);

const groupOf = (t: TermTab) => t.groupId ?? "g1";

/** Same layout when every cell is allowed and unclaimed; otherwise rebuilt without the rest. */
function clean(
  l: TileLayout,
  tabs: TermTab[],
  byId: Map<string, TermTab>,
  allowed: (t: TermTab) => boolean,
  taken: Set<string>,
): TileLayout | null {
  const ok =
    l.cells.length >= 2 &&
    l.cells.every((c) => {
      const t = byId.get(c.tabId);
      return !!t && allowed(t) && !taken.has(c.tabId);
    });
  const out = ok
    ? l
    : normalizeLayout(
        tabs.filter((t) => allowed(t) && !taken.has(t.id)),
        l,
      );
  out?.cells.forEach((c) => taken.add(c.tabId));
  return out;
}

export function reconcileSplits(s: TerminalState): TerminalState {
  const taken = new Set<string>();
  const byId = new Map(s.tabs.map((t) => [t.id, t]));
  const inline = (g: string) => (t: TermTab) => !t.detached && !t.hidden && groupOf(t) === g;
  let changed = false;

  let layout = s.layout ? clean(s.layout, s.tabs, byId, inline(s.activeGroupId), taken) : null;
  changed ||= layout !== s.layout;

  let savedLayouts = s.savedLayouts;
  for (const [g, l] of Object.entries(s.savedLayouts ?? {})) {
    const next = l ? clean(l, s.tabs, byId, inline(g), taken) : null;
    if (next !== l) {
      savedLayouts = savedLayouts === s.savedLayouts ? { ...savedLayouts } : savedLayouts;
      savedLayouts[g] = next;
    }
  }
  changed ||= savedLayouts !== s.savedLayouts;

  const parked: TileLayout[] = [];
  for (const p of s.parkedLayouts ?? []) {
    // The project comes from any member still open (the first cell may have closed)
    const first = p.cells.map((c) => byId.get(c.tabId)).find((t) => !!t);
    const next = first ? clean(p, s.tabs, byId, inline(groupOf(first)), taken) : null;
    changed ||= next !== p;
    if (next) {
      parked.push(next);
    }
  }

  const active = s.tabs.find((t) => t.id === s.activeTabId);
  if (active && inline(s.activeGroupId)(active) && !inLayout(layout, active.id)) {
    const i = parked.findIndex((p) => inLayout(p, active.id));
    if (layout || i >= 0) {
      if (layout) {
        parked.push(layout);
      }
      layout = i >= 0 ? parked.splice(i, 1)[0] : null;
      changed = true;
    }
  }

  if (!changed) {
    return s;
  }
  return {
    ...s,
    layout,
    savedLayouts,
    parkedLayouts: parked.length || s.parkedLayouts ? parked : undefined,
  };
}

/** Every split group of `groupId` (shown one first when it is the active project). */
export function projectLayouts(s: TerminalState, groupId: string): TileLayout[] {
  const tabGroup = new Map(s.tabs.map((t) => [t.id, groupOf(t)]));
  const own = (l: TileLayout | null | undefined): l is TileLayout =>
    !!l && tabGroup.get(l.cells[0]?.tabId) === groupId;
  return [
    groupId === s.activeGroupId ? s.layout : s.savedLayouts[groupId],
    ...(s.parkedLayouts ?? []),
  ].filter(own);
}

/** True when the tab is a member of any split group (shown, parked or saved). */
export function inAnyGroup(s: TerminalState, id: string): boolean {
  return [s.layout, ...Object.values(s.savedLayouts ?? {}), ...(s.parkedLayouts ?? [])].some((l) =>
    inLayout(l, id),
  );
}

/** The parked group holding `tabId` comes on screen; the shown one is parked. */
export function withGroupShown(s: TerminalState, tabId: string): TerminalState {
  const i = (s.parkedLayouts ?? []).findIndex((l) => inLayout(l, tabId));
  if (inLayout(s.layout, tabId) || i < 0) {
    return s;
  }
  const parked = [...s.parkedLayouts!];
  const [group] = parked.splice(i, 1);
  if (s.layout) {
    parked.push(s.layout);
  }
  return { ...s, layout: group, parkedLayouts: parked };
}
