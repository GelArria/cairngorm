export interface ContextMenuItem {
  label: string;
  action: () => void;
  /** Hint shown on the right — only for shortcuts that really work. */
  shortcut?: string;
  separator?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** A row of colour swatches instead of a plain item (pointer only; arrows skip it). */
  colors?: { current: string | null | undefined; onPick: (color: string | null) => void };
}

/** "Colour" swatch row for a context menu. */
export const colorItem = (
  current: string | null | undefined,
  onPick: (color: string | null) => void,
): ContextMenuItem => ({ label: "Color", action: () => {}, colors: { current, onPick } });

export const SEP: ContextMenuItem = { label: "", action: () => {}, separator: true };

/** Join groups with separators; empty groups and `false` entries are skipped. */
export function groups(...gs: (ContextMenuItem | false | null | undefined)[][]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const g of gs) {
    const items = g.filter((i): i is ContextMenuItem => !!i);
    if (items.length === 0) {
      continue;
    }
    if (out.length) {
      out.push(SEP);
    }
    out.push(...items);
  }
  return out;
}
