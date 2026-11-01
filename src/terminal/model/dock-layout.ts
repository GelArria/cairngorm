// Docking a tab dragged from the tab bar onto a pane's edge: pure grid
// geometry. The dragged tab leaves its old cell (if any) and takes a new
// column / row beside the target, keeping the target's span on that axis;
// neighbours that crossed or ended at the new line grow into it (no holes).
import type { TileCell, TileLayout } from "./types";

export type DockEdge = "left" | "right" | "top" | "bottom" | "center";

/** Which zone of a pane the pointer is in: centre box (middle 40 %) or the nearest edge. */
export function dockEdgeAt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): DockEdge {
  const fx = (x - rect.left) / rect.width,
    fy = (y - rect.top) / rect.height;
  if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) {
    return "center";
  }
  const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
  return (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[b] < d[a] ? b : a));
}

/** Preview rectangle (fractions of the pane) for an edge. */
export function dockZone(edge: DockEdge): { x: number; y: number; w: number; h: number } {
  switch (edge) {
    case "left":
      return { x: 0, y: 0, w: 0.5, h: 1 };
    case "right":
      return { x: 0.5, y: 0, w: 0.5, h: 1 };
    case "top":
      return { x: 0, y: 0, w: 1, h: 0.5 };
    case "bottom":
      return { x: 0, y: 0.5, w: 1, h: 0.5 };
    default:
      return { x: 0, y: 0, w: 1, h: 1 };
  }
}

/** Drop columns / rows no cell touches (after the dragged cell left). */
function compact(cells: TileCell[], ratios: number[], rowRatios?: number[]) {
  const cols = [
    ...new Set(cells.flatMap((c) => Array.from({ length: c.colSpan }, (_, i) => c.col + i))),
  ].sort((a, b) => a - b);
  const rows = [
    ...new Set(cells.flatMap((c) => Array.from({ length: c.rowSpan }, (_, i) => c.row + i))),
  ].sort((a, b) => a - b);
  const cm = new Map(cols.map((c, i) => [c, i])),
    rm = new Map(rows.map((r, i) => [r, i]));
  for (const c of cells) {
    const endC = cm.get(c.col + c.colSpan - 1)!,
      endR = rm.get(c.row + c.rowSpan - 1)!;
    c.col = cm.get(c.col)!;
    c.row = rm.get(c.row)!;
    c.colSpan = endC - c.col + 1;
    c.rowSpan = endR - c.row + 1;
  }
  return {
    columnCount: cols.length,
    ratios: cols.map((c) => ratios[c] ?? 1),
    rowRatios: rowRatios ? rows.map((r) => rowRatios[r] ?? 1) : undefined,
  };
}

/** Close holes by growing a neighbour from any side (up, left, down, right). */
export function fillAll(cells: TileCell[], columnCount: number) {
  const free = (k: number, r: number) =>
    !cells.some((c) => k >= c.col && k < c.col + c.colSpan && r >= c.row && r < c.row + c.rowSpan);
  const rows = () => Math.max(1, ...cells.map((c) => c.row + c.rowSpan));
  for (let guard = 0; guard < 200; guard++) {
    let grew = false;
    for (let r = 0; r < rows() && !grew; r++) {
      for (let k = 0; k < columnCount && !grew; k++) {
        if (!free(k, r)) {
          continue;
        }
        for (const c of cells) {
          const colsFree = (row: number) =>
            Array.from({ length: c.colSpan }, (_, i) => c.col + i).every((x) => free(x, row));
          const rowsFree = (col: number) =>
            Array.from({ length: c.rowSpan }, (_, i) => c.row + i).every((y) => free(col, y));
          const inCols = k >= c.col && k < c.col + c.colSpan,
            inRows = r >= c.row && r < c.row + c.rowSpan;
          if (inCols && c.row + c.rowSpan === r && colsFree(r)) {
            c.rowSpan++;
            grew = true;
            break;
          }
          if (inRows && c.col + c.colSpan === k && rowsFree(k)) {
            c.colSpan++;
            grew = true;
            break;
          }
          if (inCols && c.row === r + 1 && colsFree(r)) {
            c.row--;
            c.rowSpan++;
            grew = true;
            break;
          }
          if (inRows && c.col === k + 1 && rowsFree(k)) {
            c.col--;
            c.colSpan++;
            grew = true;
            break;
          }
        }
      }
    }
    if (!grew) {
      return;
    }
  }
}

/**
 * New layout with `dragId` docked on `edge` of `targetId`. `layout` null = single
 * view (only the target is on screen). Returns null when the target has no cell.
 * `fill` closes any hole left behind (the grid's own fillHoles).
 */
export function dockLayout(
  layout: TileLayout | null,
  dragId: string,
  targetId: string,
  edge: Exclude<DockEdge, "center">,
  newId: () => string,
  fill: (cells: TileCell[], columnCount: number) => void,
): TileLayout | null {
  let cells: TileCell[];
  let columnCount: number;
  let ratios: number[];
  let rowRatios: number[] | undefined;
  if (!layout) {
    cells = [{ id: newId(), tabId: targetId, col: 0, row: 0, colSpan: 1, rowSpan: 1 }];
    columnCount = 1;
    ratios = [1];
  } else {
    cells = layout.cells.filter((c) => c.tabId !== dragId).map((c) => ({ ...c }));
    // The dragged tab's old cell is a hole now: drop dead lines, then close it
    ({ columnCount, ratios, rowRatios } = compact(cells, layout.columnRatios, layout.rowRatios));
    fillAll(cells, columnCount);
    fill(cells, columnCount);
  }
  const t = cells.find((c) => c.tabId === targetId);
  if (!t) {
    return null;
  }
  const { col: tc, row: tr, colSpan: tcs, rowSpan: trs } = t;

  if (edge === "left" || edge === "right") {
    const at = edge === "right" ? tc + tcs : tc;
    const width = ratios[tc] ?? 1;
    for (const c of cells) {
      const inRows = c.row < tr + trs && c.row + c.rowSpan > tr;
      if (c.col < at && c.col + c.colSpan > at) {
        c.colSpan++;
      } // crosses the new column
      else if (c.col >= at) {
        c.col++;
      } else if (c.col + c.colSpan === at && !inRows) {
        c.colSpan++;
      } // ends at it: grow right
    }
    if (at === 0) {
      for (const c of cells) {
        if (c.col === 1 && !(c.row < tr + trs && c.row + c.rowSpan > tr)) {
          c.col = 0;
          c.colSpan++;
        }
      }
    }
    cells.push({ id: newId(), tabId: dragId, col: at, row: tr, colSpan: 1, rowSpan: trs });
    ratios.splice(at, 0, width);
    columnCount++;
  } else {
    const at = edge === "bottom" ? tr + trs : tr;
    rowRatios?.splice(at, 0, rowRatios[tr] ?? 1);
    for (const c of cells) {
      const inCols = c.col < tc + tcs && c.col + c.colSpan > tc;
      if (c.row < at && c.row + c.rowSpan > at) {
        c.rowSpan++;
      } // crosses the new row
      else if (c.row >= at) {
        c.row++;
      } else if (c.row + c.rowSpan === at && !inCols) {
        c.rowSpan++;
      } // ends at it: grow down
    }
    if (at === 0) {
      for (const c of cells) {
        if (c.row === 1 && !(c.col < tc + tcs && c.col + c.colSpan > tc)) {
          c.row = 0;
          c.rowSpan++;
        }
      }
    }
    cells.push({ id: newId(), tabId: dragId, col: tc, row: at, colSpan: tcs, rowSpan: 1 });
  }
  fillAll(cells, columnCount);
  fill(cells, columnCount);
  return { cells, columnCount, columnRatios: ratios, ...(rowRatios ? { rowRatios } : {}) };
}
