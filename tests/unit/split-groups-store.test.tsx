// Several split groups per project: parked groups, reattach, restore ids.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import type { TerminalState, TermTab } from "../../src/terminal/model/types";
import { workspaceCounter } from "../../src/terminal/data/workspace-storage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => {}),
}));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/terminal/data/scrollback-store", () => ({
  clearScrollback: vi.fn(),
  saveScrollback: vi.fn(),
  loadScrollback: vi.fn(),
}));

let mod: typeof import("../../src/terminal/hooks/use-terminal-tabs");
beforeEach(async () => {
  vi.resetModules();
  mod = await import("../../src/terminal/hooks/use-terminal-tabs");
});

const members = (s: TerminalState, i?: number) =>
  new Set((i === undefined ? s.layout : s.parkedLayouts![i])!.cells.map((c) => c.tabId));

/** Group {a, b, c} parked behind a loose tab d. */
function parkedTriple() {
  const { result } = renderHook(() => mod.useTerminalTabs());
  for (let i = 0; i < 4; i++) act(() => result.current.openTab({ profile: "code-assistant" }));
  const [a, b, c, d] = result.current.state.tabs.map((t) => t.id);
  act(() => result.current.setActiveTab(a));
  act(() => result.current.joinSplit(b));
  act(() => result.current.joinSplit(c, a));
  act(() => result.current.setActiveTab(d));
  return { result, a, b, c, d };
}

describe("split groups", () => {
  it("a parked group survives closing the tab in its first cell", () => {
    const { result, a, b, c } = parkedTriple();
    expect(result.current.state.layout).toBeNull();
    expect(result.current.state.parkedLayouts![0].cells[0].tabId).toBe(a);
    act(() => result.current.closeTab(a, true));
    expect(members(result.current.state, 0)).toEqual(new Set([b, c]));
  });

  it("split right on a parked member brings its group back and keeps its shape", () => {
    const { result, a, b, c } = parkedTriple();
    act(() => result.current.splitTab(b, "vertical"));
    const s = result.current.state;
    expect(s.layout!.cells).toHaveLength(4);
    expect(members(s)).toEqual(new Set([a, b, c, s.activeTabId!]));
    expect(s.layout!.columnCount).toBeLessThan(4); // not re-laid as one row of columns
  });

  it("reattaching a window without a grid brings its tabs back loose", () => {
    const { result } = renderHook(() => mod.useTerminalTabs());
    for (let i = 0; i < 2; i++) act(() => result.current.openTab({ profile: "code-assistant" }));
    const [x, y] = result.current.state.tabs;
    act(() => result.current.detachTab(x.id, "w"));
    act(() => result.current.detachTab(y.id, "w"));
    act(() => mod.attachGroup([x, y] as TermTab[], null));
    expect(result.current.state.layout).toBeNull();
    expect(result.current.state.parkedLayouts ?? []).toHaveLength(0);
  });

  it("each group keeps its own colour through splits; the user can change it", () => {
    const { result, a, b, d } = parkedTriple();
    const first = result.current.state.parkedLayouts![0].color;
    expect(first).toBeTruthy();
    act(() => result.current.splitTab(d, "vertical")); // second group
    const second = result.current.state.layout!.color;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    act(() => result.current.setActiveTab(a));
    act(() => result.current.splitTab(b, "horizontal")); // rebuilt layout keeps its colour
    expect(result.current.state.layout!.color).toBe(first);
    act(() => result.current.setGroupColor(a, "teal"));
    expect(result.current.state.layout!.color).toBe("teal");
    act(() => result.current.ungroupOf(a));
    expect(result.current.state.layout).toBeNull();
  });

  it("parked cell ids count for the restored id counter", () => {
    const state = {
      tabs: [],
      layout: null,
      activeTabId: null,
      groups: [],
      activeGroupId: "g1",
      savedLayouts: {},
      parkedLayouts: [
        {
          columnCount: 1,
          columnRatios: [1],
          cells: [{ id: "42", tabId: "1", col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
        },
      ],
    } as TerminalState;
    expect(workspaceCounter(state)).toBe(42);
  });
});
