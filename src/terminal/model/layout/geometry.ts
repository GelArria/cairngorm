import { type TermTab, type TileCell } from "../types";

/** Inline tabs of the ACTIVE group — other groups never enter the current grid. */
export function activeInline(tabs: TermTab[], activeGroupId: string): TermTab[] {
  return tabs.filter((t) => !t.detached && !t.hidden && (t.groupId ?? "g1") === activeGroupId);
}

// ── Layout invariant ───────────────────────────────────────────────────────
// If a layout exists, EVERY inline tab must have exactly one cell.
// Without this, openTab/attachGroup leave tabs without a cell → invisible, and splitTab
// over them replaced the whole layout (splits "disappeared").

export function overlaps(
  a: TileCell,
  b: { col: number; row: number; colSpan: number; rowSpan: number },
) {
  return (
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}

export function findFreeSlot(cells: TileCell[], columnCount: number): { col: number; row: number } {
  // RECTANGULAR check: with stretched cells (colSpan/rowSpan > 1), a free
  // spot may sit INSIDE another cell area → visual overlap.
  const maxRow = cells.reduce((m, c) => Math.max(m, c.row + c.rowSpan), 0);
  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col < columnCount; col++) {
      if (!cells.some((c) => overlaps(c, { col, row, colSpan: 1, rowSpan: 1 }))) {
        return { col, row };
      }
    }
  }
  return { col: 0, row: maxRow };
}

// ── Smart stretching and pane reorganization ───────────────────────────
/** Occupancy map (col,row) → cell. */
export function occupancy(cells: TileCell[]): Map<string, TileCell> {
  const occ = new Map<string, TileCell>();
  for (const c of cells) {
    for (let r = c.row; r < c.row + c.rowSpan; r++) {
      for (let k = c.col; k < c.col + c.colSpan; k++) {
        occ.set(`${k},${r}`, c);
      }
    }
  }
  return occ;
}
