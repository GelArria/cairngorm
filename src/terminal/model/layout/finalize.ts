import { fillAll } from "../dock-layout";
import { type TileCell, type TileLayout } from "../types";
import { overlaps } from "./geometry";

// ── Internal split (tmux-style, zero holes) ────────────────────────────────
// The new terminal subdivides the source cell; then the WHOLE grid is re-laid
// with a scanline (each cell in the first row-major position that does not overlap
// what is already placed) and the right/bottom edges of each row/column
// stretch to the edge — zero blanks and never overlaps, by construction.

export function relayoutTight(cells: TileCell[], columnCount: number) {
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const placed: TileCell[] = [];
  for (const c of sorted) {
    search: for (let r = 0; r < cells.length + 1; r++) {
      for (let col = 0; col + c.colSpan <= columnCount; col++) {
        if (!placed.some((p) => overlaps(p, { ...c, col, row: r }))) {
          c.col = col;
          c.row = r;
          placed.push(c);
          break search;
        }
      }
    }
  }
  // Stretch each row right edge to the grid edge (without stepping on others)
  const rowCount = Math.max(0, ...cells.map((c) => c.row + c.rowSpan));
  for (let f = 0; f < rowCount; f++) {
    const inRow = cells.filter((c) => c.row <= f && f < c.row + c.rowSpan);
    if (!inRow.length) {
      continue;
    }
    const last = inRow.reduce((a, b) => (b.col + b.colSpan > a.col + a.colSpan ? b : a));
    if (last.col + last.colSpan < columnCount) {
      const stretched = { ...last, colSpan: columnCount - last.col };
      if (!cells.some((c) => c.id !== last.id && overlaps(c, stretched))) {
        last.colSpan = stretched.colSpan;
      }
    }
  }
}

export function relayoutTightVertical(cells: TileCell[]) {
  // Vertical mirror: each column compacts upward and the bottom edge
  // of each column stretches to the bottom (without stepping on others).
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const placed: TileCell[] = [];
  for (const c of sorted) {
    search: for (let r = 0; r < cells.length + 1; r++) {
      for (let col = 0; col + c.colSpan <= columnCountOf(cells); col++) {
        if (!placed.some((p) => overlaps(p, { ...c, col, row: r }))) {
          c.col = col;
          c.row = r;
          placed.push(c);
          break search;
        }
      }
    }
  }
  const rowCount = Math.max(0, ...cells.map((c) => c.row + c.rowSpan));
  const colCount = Math.max(0, ...cells.map((c) => c.col + c.colSpan));
  for (let k = 0; k < colCount; k++) {
    const inCol = cells.filter((c) => c.col <= k && k < c.col + c.colSpan);
    if (!inCol.length) {
      continue;
    }
    const last = inCol.reduce((a, b) => (b.row + b.rowSpan > a.row + a.rowSpan ? b : a));
    if (last.row + last.rowSpan < rowCount) {
      const stretched = { ...last, rowSpan: rowCount - last.row };
      if (!cells.some((c) => c.id !== last.id && overlaps(c, stretched))) {
        last.rowSpan = stretched.rowSpan;
      }
    }
  }
}

function columnCountOf(cells: TileCell[]): number {
  return Math.max(1, ...cells.map((c) => c.col + c.colSpan));
}

/**
 * Final sanitizer: guarantees the HARD invariants of the layout after any
 * mutation — spans in range and ZERO rectangular overlaps (conflicting cell
 * is relocated with the scanline). Defense in depth: no combination
 * of splits/closes/opens can leave the grid painting over itself.
 */
export function finalizeLayout(l: TileLayout): TileLayout {
  if (!l) {
    return l;
  }
  let cells = l.cells.map((c) => ({
    ...c,
    colSpan: Math.max(1, Math.min(c.colSpan, l.columnCount - c.col)),
  }));
  // Dead columns (no cell NOR span covering them): compact like
  // normalizeLayout — remap cols and discard their ratios (dead = wasted space).
  // Trigger by span COVERAGE: a column covered by a neighbor colSpan
  // neighbor is not dead (remapping it would break spans and force a repack).
  const covered = new Set<number>();
  for (const c of cells) {
    for (let k = c.col; k < c.col + c.colSpan; k++) {
      covered.add(k);
    }
  }
  const usedCols = [...covered].sort((a, b) => a - b);
  if (usedCols.length !== l.columnCount) {
    const colMap = new Map(usedCols.map((c, i) => [c, i]));
    cells = cells.map((c) => {
      const nc = colMap.get(c.col)!;
      return { ...c, col: nc, colSpan: Math.max(1, Math.min(c.colSpan, usedCols.length - nc)) };
    });
    l = {
      ...l,
      columnCount: usedCols.length,
      columnRatios: usedCols.map((c) => l.columnRatios[c] ?? 1),
    };
  }
  const hasOverlap = cells.some((a, i) => cells.some((b, j) => j > i && overlaps(a, b)));
  if (hasOverlap) {
    relayoutTight(cells, l.columnCount);
    cells = cells.map((c) => ({
      ...c,
      colSpan: Math.max(1, Math.min(c.colSpan, l.columnCount - c.col)),
    }));
  }
  // No holes ever: a neighbour on any side grows into each empty slot.
  fillAll(cells, l.columnCount);
  return { ...l, cells };
}
