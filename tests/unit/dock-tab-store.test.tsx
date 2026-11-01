import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import type { TerminalState } from "../../src/terminal/model/types";

// Full dockTab path (dock → add missing cells → fill → finalize) on the real store.
let mod: typeof import("../../src/terminal/hooks/use-terminal-tabs");
beforeEach(async () => {
  vi.resetModules();
  mod = await import("../../src/terminal/hooks/use-terminal-tabs");
});

function expectTiled(s: TerminalState) {
  const l = s.layout!;
  const inline = s.tabs.filter((t) => !t.detached && t.groupId === s.activeGroupId);
  // The group holds only tabs of this project (others stay loose) and the active one.
  const ids = new Set(inline.map((t) => t.id));
  expect(l.cells.every((c) => ids.has(c.tabId))).toBe(true);
  expect(l.cells.map((c) => c.tabId)).toContain(s.activeTabId);
  const rows = Math.max(...l.cells.map((c) => c.row + c.rowSpan));
  const seen = new Set<string>();
  for (const c of l.cells)
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let k = c.col; k < c.col + c.colSpan; k++) {
        expect(seen.has(`${k},${r}`), `overlap at ${k},${r}`).toBe(false);
        seen.add(`${k},${r}`);
      }
  expect(seen.size, "holes").toBe(l.columnCount * rows);
}

function setup(n: number) {
  const { result } = renderHook(() => mod.useTerminalTabs());
  act(() => mod.syncProjectGroups([{ id: "p1", name: "P" }], "p1"));
  for (let i = 0; i < n; i++)
    act(() => result.current.openTab({ profile: "code-assistant", title: `T${i}` }));
  act(() => result.current.setActiveTab(result.current.state.tabs[0].id));
  return result;
}

describe("dockTab (store path)", () => {
  it("3 tabs, single view: dock left, then right — stays a side-by-side grid, never a stack", () => {
    const r = setup(3);
    const [a, b] = r.current.state.tabs.map((t) => t.id);
    act(() => r.current.dockTab(b, a, "left"));
    expectTiled(r.current.state);
    act(() => r.current.dockTab(b, a, "right"));
    const s = r.current.state;
    expectTiled(s);
    const ca = s.layout!.cells.find((c) => c.tabId === a)!,
      cb = s.layout!.cells.find((c) => c.tabId === b)!;
    expect(cb.col).toBe(ca.col + ca.colSpan); // B right of A
    expect(cb.row).toBe(ca.row);
  });

  it("dragging the visible tab onto its own edge splits (single view)", () => {
    const r = setup(2);
    const [a] = r.current.state.tabs.map((t) => t.id);
    act(() => r.current.dockTab(a, a, "left"));
    const s = r.current.state;
    expectTiled(s);
    expect(s.layout!.cells.find((c) => c.tabId === a)!.col).toBe(0);
    expect(s.layout!.columnCount).toBe(2);
  });

  it("the only tab dropped on its own right edge gets a new terminal beside it", () => {
    const r = setup(1);
    const a = r.current.state.tabs[0].id;
    act(() => r.current.dockTab(a, a, "right"));
    const s = r.current.state;
    expect(s.tabs).toHaveLength(2);
    expectTiled(s);
    expect(s.layout!.cells.find((c) => c.tabId === a)!.col).toBe(1);
    expect(s.activeTabId).toBe(a);
  });

  it("random dock sequences with 4 tabs never overlap, leave holes or lose a tab", () => {
    const r = setup(4);
    const ids = r.current.state.tabs.map((t) => t.id);
    const edges = ["left", "right", "top", "bottom", "center"] as const;
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const d = ids[rnd(4)],
        t = ids[rnd(4)];
      act(() => r.current.dockTab(d, t, edges[rnd(5)]));
      if (r.current.state.layout) expectTiled(r.current.state);
    }
  });
});
