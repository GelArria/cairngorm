import { debugLog } from "../data/terminal-debug-logger";
import { type DockEdge, dockLayout } from "../model/dock-layout";
import { absorbHoles, fillHoles } from "../model/layout/fill-holes";
import { finalizeLayout } from "../model/layout/finalize";
import { getRowRatios, resizeTrackRatios } from "../model/layout/track-sizing";
import { setActiveTab } from "./file-actions";
import { uid } from "./id-counter";
import { splitTab } from "./split-actions";
import { currentState, setState } from "./terminal-store";

/** Drag & drop: move the terminal into a grid hole; fills and stretches. */
export function moveCell(id: string, col: number, row: number) {
  setState((prev) => {
    if (!prev.layout) {
      return prev;
    }
    const cells = prev.layout.cells.map((c) => ({ ...c }));
    const c = cells.find((x) => x.tabId === id);
    if (!c) {
      return prev;
    }
    const maxRow = Math.max(0, ...cells.map((o) => o.row + o.rowSpan));
    c.col = Math.min(Math.max(0, col), prev.layout.columnCount - 1);
    c.row = Math.min(Math.max(0, row), Math.max(0, maxRow - 1));
    c.colSpan = 1;
    c.rowSpan = 1;
    fillHoles(cells, prev.layout.columnCount);
    absorbHoles(cells, c, prev.layout.columnCount);
    return { ...prev, layout: finalizeLayout({ ...prev.layout, cells }) };
  });
}

/** Tab dragged from the bar onto a pane: an edge docks it beside that pane
 *  (splitting the view), the centre swaps the two (or just shows it). */
export function dockTab(dragId: string, targetId: string, edge: DockEdge): void {
  debugLog("tabs", "dockTab", `drag=${dragId} target=${targetId} edge=${edge}`);
  if (dragId === targetId) {
    return dockSelf(dragId, edge);
  }
  setState((prev) => {
    const drag = prev.tabs.find((t) => t.id === dragId);
    if (!drag || drag.detached) {
      return prev;
    }
    if (edge === "center") {
      const hasBoth =
        prev.layout?.cells.some((c) => c.tabId === dragId) &&
        prev.layout?.cells.some((c) => c.tabId === targetId);
      if (!hasBoth) {
        return { ...prev, activeTabId: dragId };
      }
      const cells = prev.layout!.cells.map((c) =>
        c.tabId === dragId
          ? { ...c, tabId: targetId }
          : c.tabId === targetId
            ? { ...c, tabId: dragId }
            : c,
      );
      return { ...prev, layout: { ...prev.layout!, cells }, activeTabId: dragId };
    }
    const docked = dockLayout(prev.layout, dragId, targetId, edge, uid, fillHoles);
    if (!docked) {
      return prev;
    }
    // Only the dragged tab joins: other open tabs stay outside the group.
    return { ...prev, layout: finalizeLayout(docked), activeTabId: dragId };
  });
}

/** Single view, the visible tab dropped on its OWN pane's edge: split — it goes
 *  to that side and a new terminal takes the other one. */
function dockSelf(tabId: string, edge: DockEdge): void {
  if (edge === "center" || currentState.layout) {
    return;
  }
  splitTab(tabId, edge === "left" || edge === "right" ? "vertical" : "horizontal"); // new one lands right / below
  const fresh = currentState.activeTabId;
  // splitTab puts the new one right / below: the dropped tab must end on the side it was dropped on
  if ((edge === "right" || edge === "bottom") && fresh && fresh !== tabId) {
    swapCells(tabId, fresh);
  }
  setActiveTab(tabId);
}

/** Drag & drop onto another terminal: swap positions. */
export function swapCells(aId: string, bId: string) {
  setState((prev) => {
    if (!prev.layout) {
      return prev;
    }
    const cells = prev.layout.cells.map((c) => ({ ...c }));
    const a = cells.find((x) => x.tabId === aId);
    const b = cells.find((x) => x.tabId === bId);
    if (!a || !b || a === b) {
      return prev;
    }
    const t = { col: a.col, row: a.row, colSpan: a.colSpan, rowSpan: a.rowSpan };
    a.col = b.col;
    a.row = b.row;
    a.colSpan = b.colSpan;
    a.rowSpan = b.rowSpan;
    b.col = t.col;
    b.row = t.row;
    b.colSpan = t.colSpan;
    b.rowSpan = t.rowSpan;
    return { ...prev, layout: finalizeLayout({ ...prev.layout, cells }) };
  });
}

export function dissolveSplit() {
  debugLog("tabs", "dissolveSplit", `active=${currentState.activeTabId}`);
  setState((prev) => {
    if (!prev.layout) {
      return prev;
    }
    // Keep the active tab, dissolve layout
    return { ...prev, layout: null, activeTabId: prev.activeTabId };
  });
}

export function resizeRows(rowIndex: number, deltaPx: number, containerPx: number) {
  setState((prev) => {
    if (!prev.layout) {
      return prev;
    }
    const rowRatios = resizeTrackRatios(getRowRatios(prev.layout), rowIndex, deltaPx, containerPx);
    return { ...prev, layout: { ...prev.layout, rowRatios } };
  });
}

export function resizeColumns(colIndex: number, deltaPx: number, containerPx: number) {
  setState((prev) => {
    if (!prev.layout) {
      return prev;
    }
    const columnRatios = resizeTrackRatios(
      prev.layout.columnRatios,
      colIndex,
      deltaPx,
      containerPx,
    );
    return { ...prev, layout: { ...prev.layout, columnRatios } };
  });
}
