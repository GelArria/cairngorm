// Per-group actions from the group chip in the tab bar: colour and ungroup.
import { inLayout } from "../model/layout/split-groups";
import type { TerminalState, TileLayout } from "../model/types";
import { setState } from "./terminal-store";

/** Applies `fn` to the split group holding `tabId` (shown, saved or parked). */
function updateGroup(
  prev: TerminalState,
  tabId: string,
  fn: (l: TileLayout) => TileLayout | null,
): TerminalState {
  const map = (l: TileLayout | null) => (l && inLayout(l, tabId) ? fn(l) : l);
  return {
    ...prev,
    layout: map(prev.layout),
    savedLayouts: Object.fromEntries(
      Object.entries(prev.savedLayouts).map(([k, l]) => [k, map(l)]),
    ),
    parkedLayouts: prev.parkedLayouts?.map(map).filter((l): l is TileLayout => !!l),
  };
}

export function setGroupColor(tabId: string, color: string) {
  setState((prev) => updateGroup(prev, tabId, (l) => ({ ...l, color })));
}

/** The whole group dissolves; its tabs stay open as loose tabs. */
export function ungroupOf(tabId: string) {
  setState((prev) => updateGroup(prev, tabId, () => null));
}
