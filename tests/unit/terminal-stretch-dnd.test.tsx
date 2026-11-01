// @vitest-environment jsdom
// Automatic gap filling (fillHoles) and pane drag/drop
// (moveCell/swapCells) through use-terminal-tabs.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({
  debugLog: vi.fn(),
}));
vi.mock("../../src/terminal/data/scrollback-store", () => ({
  clearScrollback: vi.fn(),
  saveScrollback: vi.fn(),
  loadScrollback: vi.fn(),
}));

// Module-level singleton state → resetModules per test for isolation.
let mod: typeof import("../../src/terminal/hooks/use-terminal-tabs");

beforeEach(async () => {
  vi.resetModules();
  mod = await import("../../src/terminal/hooks/use-terminal-tabs");
});

function cellOf(id: string) {
  const h = renderHook(() => mod.useTerminalTabs());
  const cells = h.result.current.state.layout!.cells;
  h.unmount();
  return cells.find((c) => c.tabId === id)!;
}

function state() {
  const h = renderHook(() => mod.useTerminalTabs());
  const st = h.result.current.state;
  h.unmount();
  return st;
}

/** No rectangular overlaps and 1:1 coverage of the grid bounding. */
function expectSound(st: ReturnType<typeof state>) {
  const cells = st.layout!.cells;
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i],
        b = cells[j];
      const overlap =
        a.col < b.col + b.colSpan &&
        b.col < a.col + a.colSpan &&
        a.row < b.row + b.rowSpan &&
        b.row < a.row + a.rowSpan;
      expect(overlap, `solape ${a.tabId} vs ${b.tabId}`).toBe(false);
    }
  const occ = new Set<string>();
  for (const c of cells)
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let k = c.col; k < c.col + c.colSpan; k++) occ.add(`${k},${r}`);
  const maxRow = Math.max(...cells.map((c) => c.row + c.rowSpan));
  for (let r = 0; r < maxRow; r++)
    for (let k = 0; k < st.layout!.columnCount; k++)
      expect(occ.has(`${k},${r}`), `hole at ${k},${r}`).toBe(true);
  expect(st.layout!.columnRatios).toHaveLength(st.layout!.columnCount);
}

describe("pane stretching and drag/drop", () => {
  it("closing leaves zero holes: contiguous neighbors absorb the rectangle (user screenshot)", () => {
    const h = renderHook(() => mod.useTerminalTabs());
    act(() => h.result.current.openTab({ profile: "code-assistant" }));
    // row 0: A | B | C; row 1: D | E
    const a = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTab(a, "vertical"));
    const b = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTab(b, "horizontal"));
    const c = h.result.current.state.activeTabId!;
    act(() => h.result.current.setActiveTab(b));
    act(() => h.result.current.splitTab(b, "vertical"));
    const e = h.result.current.state.activeTabId!; // column 2, row 0
    act(() => h.result.current.setActiveTab(a));
    act(() => h.result.current.splitTab(a, "horizontal"));
    const d = h.result.current.state.activeTabId!;
    expect(h.result.current.state.layout!.cells).toHaveLength(5);
    act(() => h.result.current.closeTab(c));
    const st = h.result.current.state;
    expectSound(st);
    // nobody moved: A(0,0), B(1,0), D(2,0), E(0,1) — and ZERO holes (the
    // the neighbors above absorb by columns: B and D grow rowSpan 2)
    expect(cellOf(a)).toMatchObject({ col: 0, row: 0 });
    expect(cellOf(d)).toMatchObject({ col: 0, row: 1 });
    expect(cellOf(b)).toMatchObject({ col: 1, row: 0, rowSpan: 2 });
    expect(cellOf(e)).toMatchObject({ col: 2, row: 0, rowSpan: 2 });
    h.unmount();
  });

  it("moveCell: out of range is clamped and the grid stays healthy", () => {
    const h = renderHook(() => mod.useTerminalTabs());
    act(() => h.result.current.openTab({ profile: "code-assistant" }));
    const a = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTab(a, "vertical")); // A | B
    const b = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTabInner(b, "horizontal")); // A(0,0 1x2) B(1,0) C(1,1)
    act(() => h.result.current.moveCell(a, 5, 5));
    const st = h.result.current.state;
    expectSound(st);
    expect(cellOf(a).col).toBeLessThan(st.layout!.columnCount);
    h.unmount();
  });

  it("swapCells: swaps the rectangles of two panes", () => {
    const h = renderHook(() => mod.useTerminalTabs());
    act(() => h.result.current.openTab({ profile: "code-assistant" }));
    const a = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTab(a, "vertical")); // A | B
    const b = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTabInner(b, "horizontal")); // B above C in column 1
    const c = h.result.current.state.activeTabId!;
    const aBefore = { ...cellOf(a) },
      bBefore = { ...cellOf(b) };
    act(() => h.result.current.swapCells(a, b));
    const st = h.result.current.state;
    expectSound(st);
    const aCell = cellOf(a),
      bCell = cellOf(b);
    expect({
      col: aCell.col,
      row: aCell.row,
      colSpan: aCell.colSpan,
      rowSpan: aCell.rowSpan,
    }).toEqual({
      col: bBefore.col,
      row: bBefore.row,
      colSpan: bBefore.colSpan,
      rowSpan: bBefore.rowSpan,
    });
    expect({
      col: bCell.col,
      row: bCell.row,
      colSpan: bCell.colSpan,
      rowSpan: bCell.rowSpan,
    }).toEqual({
      col: aBefore.col,
      row: aBefore.row,
      colSpan: aBefore.colSpan,
      rowSpan: aBefore.rowSpan,
    });
    h.unmount();
  });

  it("moveCell to an occupied target: does not break, the grid stays healthy", () => {
    const h = renderHook(() => mod.useTerminalTabs());
    act(() => h.result.current.openTab({ profile: "code-assistant" }));
    const a = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTab(a, "vertical")); // A | B
    const b = h.result.current.state.activeTabId!;
    act(() => h.result.current.splitTab(b, "horizontal")); // A(0,0 1x2) B(1,0) C(1,1)
    const c = h.result.current.state.activeTabId!;
    act(() => h.result.current.moveCell(c, 0, 0)); // (0,0) occupied by A → clash
    const st = h.result.current.state;
    expectSound(st);
    h.unmount();
  });
});
