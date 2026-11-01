import { type TermTab, type TileLayout } from "../types";
import { fillHoles } from "./fill-holes";
import { finalizeLayout } from "./finalize";

/** Drops cells of `tabs` that are gone (or detached), compacts dead lines and
 *  closes holes. Tabs without a cell stay OUTSIDE the split group — they are
 *  never added. Null when fewer than two cells remain (no split). */
export function normalizeLayout(
  tabs: TermTab[],
  layout: TileLayout | null,
  repack = false,
): TileLayout | null {
  if (!layout) {
    return null;
  }
  const inline = new Set(tabs.filter((t) => !t.detached).map((t) => t.id));
  let cells = layout.cells.filter((c) => inline.has(c.tabId));
  if (cells.length < 2) {
    return null;
  }
  // Compact empty columns: closing a middle tab leaves no dead column.
  // Spanned lines are occupied too; counting only origins destroys restored grids.
  const coveredCols = new Set(cells.map((c) => c.col));
  for (const c of cells) {
    for (let col = c.col + 1; col < Math.min(c.col + c.colSpan, layout.columnCount); col++) {
      coveredCols.add(col);
    }
  }
  const usedCols = [...coveredCols].sort((a, b) => a - b);
  const colMap = new Map(usedCols.map((c, i) => [c, i]));
  cells = cells.map((c) => ({ ...c, col: colMap.get(c.col)! }));
  const columnCount = usedCols.length;
  const columnRatios = usedCols.map((c) => layout.columnRatios[c] ?? 1);
  // Compact empty rows (closing the only cell of an intermediate row)
  const coveredRows = new Set(cells.map((c) => c.row));
  for (const c of cells) {
    for (let row = c.row + 1; row < c.row + c.rowSpan; row++) {
      coveredRows.add(row);
    }
  }
  const usedRows = [...coveredRows].sort((a, b) => a - b);
  const rowMap = new Map(usedRows.map((r, i) => [r, i]));
  cells = cells.map((c) => ({ ...c, row: rowMap.get(c.row)! }));
  // Sanity: colSpan escaping the grid (legacy states with spans) is clipped
  cells = cells.map((c) => ({
    ...c,
    colSpan: Math.max(1, Math.min(c.colSpan, columnCount - c.col)),
  }));
  if (repack) {
    // On CLOSE: fill gaps (e.g. 2 diagonal panes with empty quadrants)
    // reassigning in reading order. Preserves column widths (ratios).
    cells = [...cells]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((c, i) => ({ ...c, col: i % columnCount, row: Math.floor(i / columnCount) }));
  }
  // Survivors absorb the space a removed pane left: the group always fills the area.
  fillHoles(cells, columnCount);
  return finalizeLayout({
    ...layout,
    cells,
    columnCount,
    columnRatios,
    ...(layout.rowRatios ? { rowRatios: usedRows.map((r) => layout.rowRatios![r] ?? 1) } : {}),
  });
}
