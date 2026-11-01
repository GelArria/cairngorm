// Split group colours: every group keeps one label colour (TAG_COLORS id).
// Layout rebuilds (split, close, arrange, dock…) produce objects without it, so
// after each state change a group inherits the colour its members had before;
// a brand-new group takes the first colour no other group uses.
import { TAG_COLORS } from "@/appearance/model/tag-colors";
import type { TerminalState, TileLayout } from "../types";

const layoutsOf = (s: TerminalState): TileLayout[] =>
  [s.layout, ...Object.values(s.savedLayouts ?? {}), ...(s.parkedLayouts ?? [])].filter(
    (l): l is TileLayout => !!l,
  );

export function paintGroups(s: TerminalState, prev: TerminalState): TerminalState {
  const layouts = layoutsOf(s);
  if (layouts.every((l) => l.color)) {
    return s;
  }
  const before = new Map<string, string>();
  for (const l of layoutsOf(prev)) {
    for (const c of l.cells) {
      if (l.color) {
        before.set(c.tabId, l.color);
      }
    }
  }
  const used = new Set(layouts.map((l) => l.color).filter(Boolean));
  const paint = <T extends TileLayout | null>(l: T): T => {
    if (!l || l.color) {
      return l;
    }
    const inherited = l.cells.map((c) => before.get(c.tabId)).find((c) => c && !used.has(c));
    const color =
      inherited ??
      TAG_COLORS.find((t) => !used.has(t.id))?.id ??
      TAG_COLORS[used.size % TAG_COLORS.length].id;
    used.add(color);
    return { ...l, color };
  };
  return {
    ...s,
    layout: paint(s.layout),
    savedLayouts: Object.fromEntries(
      Object.entries(s.savedLayouts ?? {}).map(([k, l]) => [k, paint(l)]),
    ),
    parkedLayouts: s.parkedLayouts?.map(paint),
  };
}
