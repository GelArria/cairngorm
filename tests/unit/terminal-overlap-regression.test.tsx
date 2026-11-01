import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import type { TerminalState, TileLayout } from "../../src/terminal/model/types";

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
function setup() {
  return renderHook(() => mod.useTerminalTabs());
}

function overlaps(
  a: { col: number; row: number; colSpan: number; rowSpan: number },
  b: { col: number; row: number; colSpan: number; rowSpan: number },
) {
  return (
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}
function expectNoOverlaps(state: TerminalState) {
  const cs = state.layout!.cells;
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++)
      expect(
        overlaps(cs[i], cs[j]),
        `solape ${i}:${JSON.stringify(cs[i])} vs ${j}:${JSON.stringify(cs[j])}`,
      ).toBe(false);
}

describe("Overlap regressions", () => {
  it("normal-v split over a stretched cell (span2) overlaps", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "horizontal")); // A above, B below
    // A's internal vertical split puts A|A2 above B, which spans the full width (span2).
    const a = result.current.state.tabs[0].id;
    act(() => result.current.setActiveTab(a));
    act(() => result.current.splitTabInner(a, "vertical"));
    expectNoOverlaps(result.current.state);
    // NOW a NORMAL-v split of B (the stretched cell below)
    const b = result.current.state.tabs.find(
      (t) => t.id !== a && t.id !== result.current.state.activeTabId,
    )!.id;
    act(() => result.current.setActiveTab(b));
    act(() => result.current.splitTab(b, "vertical"));
    expectNoOverlaps(result.current.state); // Regression check
  });

  it("normal-h split over a tall cell (rowSpan2) overlaps", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical")); // A | B
    const a = result.current.state.tabs[0].id;
    act(() => result.current.setActiveTab(a));
    act(() => result.current.splitTab(a, "horizontal")); // A(0,0), new(0,1); B(1,0)
    // B's internal horizontal split gives B a rowSpan of 2.
    const b = result.current.state.tabs.find(
      (t) => t.id !== a && t.id !== result.current.state.activeTabId,
    )!.id;
    act(() => result.current.setActiveTab(b));
    act(() => result.current.splitTabInner(b, "horizontal"));
    expectNoOverlaps(result.current.state);
    const a2 = result.current.state.tabs[0].id;
    act(() => result.current.setActiveTab(a2));
    act(() => result.current.splitTab(a2, "horizontal")); // A's normal horizontal split
    expectNoOverlaps(result.current.state); // Regression check
  });
});
