// Building split groups on purpose: pick which tab joins which group, then the
// group is re-arranged to fill the whole area (auto shape by default).
import { debugLog } from "../data/terminal-debug-logger";
import { arrangeLayout, readingOrder, type ArrangeMode } from "../model/layout/arrange";
import { gridAspect } from "../model/layout/grid-aspect";
import { normalizeLayout } from "../model/layout/normalize";
import { inLayout } from "../model/layout/split-groups";
import type { TerminalState, TileLayout } from "../model/types";
import { uid } from "./id-counter";
import { groupCwd, makeChildTab } from "./tab-factory";
import { currentState, setState } from "./terminal-store";

/** `tabId` joins the split group of `anchorId` (a new pair when the anchor is
 *  alone) and leaves any group it was in. The caller focuses a member. */
export function withJoined(
  prev: TerminalState,
  anchorId: string,
  tabId: string,
  mode: ArrangeMode = "auto",
): TerminalState {
  const anchor = prev.tabs.find((t) => t.id === anchorId);
  if (!anchor || anchor.detached || anchorId === tabId) {
    return prev;
  }
  const without = prev.tabs.filter((t) => t.id !== tabId);
  const strip = (l: TileLayout | null) =>
    l && inLayout(l, tabId) && !inLayout(l, anchorId) ? normalizeLayout(without, l) : l;
  let layout = strip(prev.layout);
  const parked = (prev.parkedLayouts ?? []).map(strip).filter((l): l is TileLayout => !!l);
  const savedLayouts = { ...prev.savedLayouts };
  const group = anchor.groupId ?? "g1";

  let base: TileLayout | null = null;
  if (inLayout(layout, anchorId)) {
    [base, layout] = [layout, null];
  } else if (parked.some((p) => inLayout(p, anchorId))) {
    base = parked.splice(
      parked.findIndex((p) => inLayout(p, anchorId)),
      1,
    )[0];
  } else if (inLayout(savedLayouts[group], anchorId)) {
    [base, savedLayouts[group]] = [savedLayouts[group], null];
  }
  const ids = [...(base ? readingOrder(base).filter((id) => id !== tabId) : [anchorId]), tabId];
  const joined = arrangeLayout(ids, mode, gridAspect(), uid);
  if (group === prev.activeGroupId) {
    if (layout) {
      parked.push(layout);
    }
    layout = joined;
  } else if (joined) {
    parked.push(joined);
  }
  return { ...prev, layout, parkedLayouts: parked, savedLayouts };
}

/** Bring an existing tab into the active tab's split group. */
export function joinSplit(tabId: string, anchorId = currentState.activeTabId) {
  debugLog("tabs", "joinSplit", `tab=${tabId} anchor=${anchorId}`);
  if (!anchorId) {
    return;
  }
  setState((prev) => {
    const next = withJoined(prev, anchorId, tabId);
    return next === prev ? prev : { ...next, activeTabId: tabId };
  });
}

/** A new terminal joins `anchorId`'s split group. */
export function splitWithNew(anchorId = currentState.activeTabId) {
  debugLog("tabs", "splitWithNew", `anchor=${anchorId}`);
  setState((prev) => {
    const source = prev.tabs.find((t) => t.id === anchorId);
    if (!source || source.detached) {
      return prev;
    }
    const tab = makeChildTab(source, uid(), prev.activeGroupId, groupCwd(prev, prev.activeGroupId));
    const next = withJoined({ ...prev, tabs: [...prev.tabs, tab] }, source.id, tab.id);
    return { ...next, activeTabId: tab.id };
  });
}

/** Re-lay the split group on screen so every pane shares the whole area. */
export function arrangeSplit(mode: ArrangeMode) {
  setState((prev) => {
    if (!prev.layout) {
      return prev;
    }
    const layout = arrangeLayout(readingOrder(prev.layout), mode, gridAspect(), uid);
    return { ...prev, layout };
  });
}

/** The tab leaves its split group (it stays open as a loose tab). */
export function removeFromSplit(tabId: string) {
  setState((prev) => {
    const without = prev.tabs.filter((t) => t.id !== tabId);
    const strip = (l: TileLayout | null) => (inLayout(l, tabId) ? normalizeLayout(without, l) : l);
    const layout = strip(prev.layout);
    const parkedLayouts = (prev.parkedLayouts ?? []).map(strip).filter((l): l is TileLayout => !!l);
    // Stay on the group that remains instead of jumping to the removed tab alone.
    const activeTabId =
      prev.activeTabId === tabId && layout ? layout.cells[0].tabId : prev.activeTabId;
    return { ...prev, layout, parkedLayouts, activeTabId };
  });
}
