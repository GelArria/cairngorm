import { debugLog } from "../data/terminal-debug-logger";
import { finalizeLayout, relayoutTight, relayoutTightVertical } from "../model/layout/finalize";
import { overlaps } from "../model/layout/geometry";
import { withGroupShown } from "../model/layout/split-groups";
import { type TileCell } from "../model/types";
import { uid } from "./id-counter";
import { withJoined } from "./split-group-actions";
import { groupCwd, makeChildTab } from "./tab-factory";
import { currentState, setState } from "./terminal-store";

export function splitTab(tabId: string, direction: "horizontal" | "vertical") {
  debugLog("tabs", "splitTab", `id=${tabId} dir=${direction}`);
  setState((prev) => {
    const source = prev.tabs.find((t) => t.id === tabId);
    if (!source || source.detached) {
      return prev;
    }
    const newId = uid();
    const tab = makeChildTab(source, newId, prev.activeGroupId, groupCwd(prev, prev.activeGroupId));
    const tabs = [...prev.tabs, tab];

    // Grow the source's group (a parked one comes back first); otherwise pair below.
    prev = withGroupShown(prev, tabId);
    const layout = prev.layout;
    const srcCell = layout?.cells.find((c) => c.tabId === tabId);
    if (layout && srcCell) {
      let cells: TileCell[];
      let columnCount = layout.columnCount;
      let columnRatios = [...layout.columnRatios];
      const rowRatios = layout.rowRatios ? [...layout.rowRatios] : undefined;
      // A pane stretched over several rows/columns is halved along the split
      // axis: the new terminal takes part of the SOURCE's own area.
      const span = direction === "vertical" ? srcCell.colSpan : srcCell.rowSpan;
      if (span >= 2) {
        const keep = Math.ceil(span / 2);
        const src = srcCell;
        cells = layout.cells.map((c) =>
          c.id !== src.id
            ? { ...c }
            : direction === "vertical"
              ? { ...c, colSpan: keep }
              : { ...c, rowSpan: keep },
        );
        cells.push(
          direction === "vertical"
            ? { ...src, id: uid(), tabId: tab.id, col: src.col + keep, colSpan: span - keep }
            : { ...src, id: uid(), tabId: tab.id, row: src.row + keep, rowSpan: span - keep },
        );
        return {
          ...prev,
          tabs,
          layout: finalizeLayout({ ...layout, cells, columnCount, columnRatios }),
          activeTabId: tab.id,
        };
      }
      // their colSpan/rowSpan — with cells stretched by the internal split, dropping
      // "to the right of the cell" meant dropping INSIDE the source → overlaps).
      const tCol = direction === "vertical" ? srcCell.col + srcCell.colSpan : srcCell.col;
      const tRow = direction === "vertical" ? srcCell.row : srcCell.row + srcCell.rowSpan;
      const nColSpan = direction === "vertical" ? 1 : srcCell.colSpan;
      const nRowSpan = direction === "vertical" ? srcCell.rowSpan : 1;
      const free = !layout.cells.some(
        (c) =>
          c.id !== srcCell.id &&
          overlaps(c, { col: tCol, row: tRow, colSpan: nColSpan, rowSpan: nRowSpan }),
      );
      if (free && tCol < columnCount) {
        cells = [
          ...layout.cells,
          { id: uid(), tabId: tab.id, col: tCol, row: tRow, colSpan: nColSpan, rowSpan: nRowSpan },
        ];
        return {
          ...prev,
          tabs,
          layout: finalizeLayout({ ...layout, cells, columnCount, columnRatios }),
          activeTabId: tab.id,
        };
      }
      if (direction === "vertical") {
        // new column to the right of the source rectangle
        const right = srcCell.col + srcCell.colSpan;
        cells = [
          ...layout.cells.map((c) => (c.col >= right ? { ...c, col: c.col + 1 } : { ...c })),
          {
            id: uid(),
            tabId: tab.id,
            col: right,
            row: srcCell.row,
            colSpan: 1,
            rowSpan: srcCell.rowSpan,
          },
        ];
        columnCount += 1;
        columnRatios.splice(right, 0, 1);
      } else {
        // occupy (fully or partially) the source columns below its bottom edge
        const bottom = srcCell.row + srcCell.rowSpan;
        rowRatios?.splice(bottom, 0, rowRatios[srcCell.row] ?? 1);
        cells = [
          ...layout.cells.map((c) =>
            c.row >= bottom &&
            c.col < srcCell.col + srcCell.colSpan &&
            c.col + c.colSpan > srcCell.col
              ? { ...c, row: c.row + 1 }
              : { ...c },
          ),
          {
            id: uid(),
            tabId: tab.id,
            col: srcCell.col,
            row: bottom,
            colSpan: srcCell.colSpan,
            rowSpan: 1,
          },
        ];
      }
      return {
        ...prev,
        tabs,
        layout: finalizeLayout({
          ...layout,
          cells,
          columnCount,
          columnRatios,
          ...(rowRatios ? { rowRatios } : {}),
        }),
        activeTabId: tab.id,
      };
    }

    // Source alone: it pairs with the new terminal; other open tabs stay OUT of
    // the group (a shown group of another pair is parked, not merged).
    const paired = withJoined(
      { ...prev, tabs },
      tabId,
      tab.id,
      direction === "vertical" ? "columns" : "rows",
    );
    return { ...paired, activeTabId: tab.id };
  });
}

export function splitTabInner(tabId: string, direction: "horizontal" | "vertical") {
  debugLog("tabs", "splitTabInner", `id=${tabId} dir=${direction}`);
  // Pre-setState plan: no layout/cell, or split-h with the bottom cell occupied
  // (cannot be inserted without rearranging) → fallback to the normal split.
  const layout = currentState.layout;
  const srcCell = layout?.cells.find((c) => c.tabId === tabId);
  if (!layout || !srcCell) {
    return splitTab(tabId, direction);
  }
  if (direction === "horizontal") {
    const tRow = srcCell.row + srcCell.rowSpan;
    const blocked = layout.cells.some((c) =>
      overlaps(c, { col: srcCell.col, row: tRow, colSpan: srcCell.colSpan, rowSpan: 1 }),
    );
    if (blocked) {
      return splitTab(tabId, direction);
    }
  }
  setState((prev) => {
    const source = prev.tabs.find((t) => t.id === tabId);
    if (!source || source.detached) {
      return prev;
    }
    const newId = uid();
    const tab = makeChildTab(source, newId, prev.activeGroupId, groupCwd(prev, prev.activeGroupId));
    const tabs = [...prev.tabs, tab];
    const cur = prev.layout!;
    const src = cur.cells.find((c) => c.tabId === tabId)!;
    const cells = cur.cells.map((c) => ({ ...c }));
    let columnCount = cur.columnCount;
    const columnRatios = [...cur.columnRatios];
    if (direction === "vertical") {
      // Adjacent to the source if the gap is free; otherwise, new column at the end.
      let tCol = src.col + src.colSpan;
      if (
        tCol >= columnCount ||
        cells.some((c) =>
          overlaps(c, { col: tCol, row: src.row, colSpan: 1, rowSpan: src.rowSpan }),
        )
      ) {
        tCol = columnCount;
        columnCount += 1;
        columnRatios.splice(tCol, 0, 1);
      }
      cells.push({
        id: uid(),
        tabId: tab.id,
        col: tCol,
        row: src.row,
        colSpan: 1,
        rowSpan: src.rowSpan,
      });
      relayoutTight(cells, columnCount);
    } else {
      cells.push({
        id: uid(),
        tabId: tab.id,
        col: src.col,
        row: src.row + src.rowSpan,
        colSpan: src.colSpan,
        rowSpan: 1,
      });
      relayoutTightVertical(cells);
    }
    return {
      ...prev,
      tabs,
      layout: finalizeLayout({ ...cur, cells, columnCount, columnRatios }),
      activeTabId: tab.id,
    };
  });
}
