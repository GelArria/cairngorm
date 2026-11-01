// Tab grouping for the terminal bar.
// Pure and Tauri-dependency-free so it can be tested in jsdom.
import type { TermTab, TileLayout } from "./types";

export interface SplitGrouping {
  /** Tabs inside the split, in grid reading order (row, then column). */
  members: TermTab[];
  /** All other tabs (without cell or detached), in their original order. */
  others: TermTab[];
}

/**
 * Derives which tabs form the split and which do not. Null if there is no
 * split (no layout or <2 tabs with a cell) → the bar renders as usual.
 */
export function splitGrouping(tabs: TermTab[], layout: TileLayout | null): SplitGrouping | null {
  if (!layout) {
    return null;
  }
  const cellOf = new Map(layout.cells.map((c) => [c.tabId, c]));
  const members = tabs
    .filter((t) => !t.detached && cellOf.has(t.id))
    .sort((a, b) => {
      const ca = cellOf.get(a.id)!;
      const cb = cellOf.get(b.id)!;
      return ca.row - cb.row || ca.col - cb.col;
    });
  if (members.length < 2) {
    return null;
  }
  const memberIds = new Set(members.map((t) => t.id));
  return { members, others: tabs.filter((t) => !memberIds.has(t.id)) };
}

export type TabBarSegment =
  | { kind: "group"; members: TermTab[]; shown: boolean; color?: string }
  | { kind: "tab"; tab: TermTab };

/**
 * Tab bar pieces in tab order: each split group renders as one block (members
 * in grid reading order) where its first member sits; loose tabs stay single.
 * `shown` is the group on screen, when there is one.
 */
export function tabBarSegments(
  tabs: TermTab[],
  layouts: TileLayout[],
  shown: TileLayout | null,
): TabBarSegment[] {
  const owner = new Map<string, { members: TermTab[]; shown: boolean; color?: string }>();
  for (const l of layouts) {
    const grouping = splitGrouping(tabs, l);
    for (const t of grouping?.members ?? []) {
      owner.set(t.id, { members: grouping!.members, shown: l === shown, color: l.color });
    }
  }
  const emitted = new Set<TermTab[]>();
  const segments: TabBarSegment[] = [];
  for (const tab of tabs) {
    const group = owner.get(tab.id);
    if (!group) {
      segments.push({ kind: "tab", tab });
    } else if (!emitted.has(group.members)) {
      emitted.add(group.members);
      segments.push({ kind: "group", ...group });
    }
  }
  return segments;
}
