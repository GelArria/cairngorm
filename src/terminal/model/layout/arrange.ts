// Whole-group arrangements: every pane gets a share of the area, zero holes.
// "auto" picks the shape from the pane count and the area's aspect ratio.
import type { TileCell, TileLayout } from "../types";
import { fillHoles } from "./fill-holes";

export type ArrangeMode = "auto" | "columns" | "rows" | "grid";

type Place = [col: number, row: number, colSpan: number, rowSpan: number];

/** Tab ids of a layout in reading order (row, then column). */
export function readingOrder(layout: TileLayout): string[] {
  return [...layout.cells].sort((a, b) => a.row - b.row || a.col - b.col).map((c) => c.tabId);
}

function line(n: number, vertical: boolean): { columnCount: number; places: Place[] } {
  return {
    columnCount: vertical ? 1 : n,
    places: Array.from({ length: n }, (_, i) => (vertical ? [0, i, 1, 1] : [i, 0, 1, 1])),
  };
}

/** Near-square grid; a short last row is stretched by its neighbours. */
function grid(n: number, aspect: number): { columnCount: number; places: Place[] } {
  const cols = Math.min(n, Math.max(1, Math.round(Math.sqrt(n * aspect))));
  return {
    columnCount: cols,
    places: Array.from({ length: n }, (_, i) => [i % cols, Math.floor(i / cols), 1, 1]),
  };
}

function shape(n: number, mode: ArrangeMode, aspect: number) {
  if (mode === "columns") {
    return line(n, false);
  }
  if (mode === "rows") {
    return line(n, true);
  }
  if (mode === "grid") {
    return grid(n, aspect);
  }
  // auto: a pane should never get much narrower/taller than the area itself
  if (n === 2) {
    return line(2, aspect < 1.1);
  }
  if (n === 3) {
    if (aspect >= 2.4 || aspect <= 0.55) {
      return line(3, aspect <= 0.55);
    }
    // one large pane plus two stacked beside (wide) or under it (tall)
    const places: Place[] =
      aspect >= 1
        ? [
            [0, 0, 1, 2],
            [1, 0, 1, 1],
            [1, 1, 1, 1],
          ]
        : [
            [0, 0, 2, 1],
            [0, 1, 1, 1],
            [1, 1, 1, 1],
          ];
    return { columnCount: 2, places };
  }
  if (n === 4 && aspect < 3.2 && aspect > 0.35) {
    return grid(4, 1); // 2 × 2 mosaic
  }
  return grid(n, aspect);
}

/** Fresh layout for `tabIds` (in order) arranged by `mode`; null below two panes. */
export function arrangeLayout(
  tabIds: string[],
  mode: ArrangeMode,
  aspect: number,
  newId: () => string,
): TileLayout | null {
  if (tabIds.length < 2) {
    return null;
  }
  const { columnCount, places } = shape(tabIds.length, mode, aspect > 0 ? aspect : 16 / 9);
  const cells: TileCell[] = tabIds.map((tabId, i) => {
    const [col, row, colSpan, rowSpan] = places[i];
    return { id: newId(), tabId, col, row, colSpan, rowSpan };
  });
  fillHoles(cells, columnCount);
  return { cells, columnCount, columnRatios: Array.from({ length: columnCount }, () => 1) };
}
