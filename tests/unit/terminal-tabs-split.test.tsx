// Spec: terminal splits share the layout across tabs.
// Invariant: if a layout exists, EVERY inline tab has exactly one cell,
// no cell shares (col,row), and columnRatios.length === columnCount.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import type { TerminalState, TileLayout } from "../../src/terminal/model/types";

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

function setup() {
  return renderHook(() => mod.useTerminalTabs());
}

function cellKeys(l: TileLayout): string[] {
  return l.cells.map((c) => `${c.col},${c.row}`);
}

function expectLayoutInvariant(state: TerminalState) {
  // The invariant is PER GROUP: only inline tabs of the active group can have cells
  const inline = state.tabs.filter(
    (t) => !t.detached && (t.groupId ?? "g1") === state.activeGroupId,
  );
  if (!state.layout) {
    // No group on screen: the active tab shows alone, the rest are loose tabs
    return;
  }
  const { cells, columnCount, columnRatios } = state.layout;
  expect(cells.length).toBeGreaterThanOrEqual(2); // a group has two panes or more
  expect(cells.length).toBeLessThanOrEqual(inline.length); // loose tabs stay outside
  if (state.activeTabId) expect(cells.map((c) => c.tabId)).toContain(state.activeTabId);
  const rows = Math.max(...cells.map((c) => c.row + c.rowSpan));
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < columnCount; k++)
      expect(
        cells.some(
          (c) => k >= c.col && k < c.col + c.colSpan && r >= c.row && r < c.row + c.rowSpan,
        ),
        `hole at ${k},${r}`,
      ).toBe(true);
  expect(new Set(cells.map((c) => c.tabId)).size).toBe(cells.length); // no duplicates
  expect(new Set(cellKeys(state.layout)).size).toBe(cells.length); // no overlaps
  // No RECTANGULAR overlaps (with spans, a unique (col,row) is not enough)
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i],
        b = cells[j];
      expect(
        a.col < b.col + b.colSpan &&
          b.col < a.col + a.colSpan &&
          a.row < b.row + b.rowSpan &&
          b.row < a.row + a.rowSpan,
        `cells ${i} and ${j} overlap`,
      ).toBe(false);
    }
  for (const c of cells) {
    expect(c.col).toBeGreaterThanOrEqual(0);
    expect(c.col).toBeLessThan(columnCount);
    expect(inline.some((t) => t.id === c.tabId)).toBe(true);
  }
  expect(columnRatios.length).toBe(columnCount);
}

describe("terminal splits — layout sharing across tabs", () => {
  it("sequential split ×4 keeps geometry with no overlaps (4th split repro)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    for (let i = 0; i < 4; i++) {
      const active = result.current.state.activeTabId!;
      act(() => result.current.splitTab(active, "vertical"));
      expectLayoutInvariant(result.current.state);
    }
    expect(result.current.state.layout!.cells.length).toBe(5);
  });

  it("mixed split (v,h,v,h) with no overlaps", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const dirs = ["vertical", "horizontal", "vertical", "horizontal"] as const;
    for (const dir of dirs) {
      const active = result.current.state.activeTabId!;
      act(() => result.current.splitTab(active, dir));
      expectLayoutInvariant(result.current.state);
    }
    expect(result.current.state.layout!.cells.length).toBe(5);
  });

  it("opening a tab with an active split shows it alone and parks the group", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "vertical"));
    const t2 = result.current.state.activeTabId!;
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t3 = result.current.state.activeTabId!;
    expectLayoutInvariant(result.current.state);
    expect(result.current.state.layout).toBeNull(); // t3 is a loose tab, shown alone
    expect(result.current.state.parkedLayouts).toHaveLength(1);
    act(() => result.current.setActiveTab(t1)); // selecting a member brings its group back
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([t1, t2]),
    );
    expect(result.current.state.layout!.cells.some((c) => c.tabId === t3)).toBe(false);
  });

  it("splitting the freshly opened tab starts a SECOND group (existing splits survive)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "vertical"));
    const t2 = result.current.state.activeTabId!;
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t3 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t3, "vertical"));
    const t4 = result.current.state.activeTabId!;
    expectLayoutInvariant(result.current.state);
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([t3, t4]),
    );
    act(() => result.current.setActiveTab(t2));
    expectLayoutInvariant(result.current.state);
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([t1, t2]),
    );
    act(() => result.current.setActiveTab(t4));
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([t3, t4]),
    );
  });

  it("closing all tabs and reopening leaves a clean layout (no dead cells)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "vertical"));
    for (const t of [...result.current.state.tabs]) {
      act(() => result.current.closeTab(t.id));
    }
    expect(result.current.state.layout).toBeNull();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const tNew = result.current.state.activeTabId!;
    act(() => result.current.splitTab(tNew, "vertical"));
    expectLayoutInvariant(result.current.state);
    const cells = result.current.state.layout!.cells;
    for (const c of cells) {
      expect(result.current.state.tabs.some((t) => t.id === c.tabId)).toBe(true);
    }
  });

  it("detach purges the cell; a reattached single tab comes back loose", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "vertical"));
    const t2 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t2, "vertical")); // t3 in the group
    const t3 = result.current.state.activeTabId!;
    act(() => result.current.detachTab(t3, "detached-x"));
    expectLayoutInvariant(result.current.state);
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([t1, t2]),
    ); // survivors fill the space
    act(() => mod.attachGroup([result.current.state.tabs.find((t) => t.id === t3)!], null));
    expectLayoutInvariant(result.current.state);
    expect(result.current.state.activeTabId).toBe(t3);
    expect(result.current.state.layout).toBeNull(); // shown alone, group parked
    expect(result.current.state.parkedLayouts![0].cells).toHaveLength(2);
  });

  it("reattaching a split window brings it back as its own group", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "vertical"));
    const t2 = result.current.state.activeTabId!;
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const [t3, t4] = result.current.state.tabs.slice(2);
    act(() => result.current.detachTab(t3.id, "w"));
    act(() => result.current.detachTab(t4.id, "w"));
    const grid = {
      columnCount: 2,
      columnRatios: [1, 1],
      cells: [t3, t4].map((t, i) => ({
        id: `w${i}`,
        tabId: t.id,
        col: i,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
      })),
    };
    act(() => mod.attachGroup([t3, t4], grid)); // the window's grid travels back
    expectLayoutInvariant(result.current.state);
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([t3.id, t4.id]),
    );
    act(() => result.current.setActiveTab(t1));
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([t1, t2]),
    );
  });

  it("clicks across tabs (setActiveTab) do not change the geometry", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "vertical"));
    const before = JSON.stringify(result.current.state.layout);
    act(() => result.current.setActiveTab(t1));
    expect(result.current.state.activeTabId).toBe(t1);
    expect(JSON.stringify(result.current.state.layout)).toBe(before);
    expectLayoutInvariant(result.current.state);
  });

  it("a single tab generates no layout (tabs mode, no auto-split)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    expect(result.current.state.layout).toBeNull();
    expectLayoutInvariant(result.current.state);
  });

  // ── Adversaries: double click / degenerate resize / close under split ──

  it("double horizontal split on the SAME tab (double-click): no overlaps", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "horizontal"));
    act(() => result.current.splitTab(t1, "horizontal"));
    expectLayoutInvariant(result.current.state);
    expect(result.current.state.layout!.cells.length).toBe(3);
  });

  it("degenerate resizeColumns (out-of-range index / giant delta) does not corrupt ratios", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "vertical"));
    const before = result.current.state.layout!.columnRatios;
    act(() => result.current.resizeColumns(99, -1e9, 1));
    expect(result.current.state.layout!.columnRatios).toEqual(before);
    act(() => result.current.resizeColumns(0, -1e9, 1));
    expect(result.current.state.layout!.columnRatios.every((r) => r >= 0.2)).toBe(true);
  });

  it("closing the bottom tab after a horizontal split: layout dissolves cleanly", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const t1 = result.current.state.activeTabId!;
    act(() => result.current.splitTab(t1, "horizontal"));
    const t2 = result.current.state.activeTabId!;
    act(() => result.current.closeTab(t2));
    expectLayoutInvariant(result.current.state);
    expect(result.current.state.layout).toBeNull();
  });

  // ── Geometric combinations: mid close, resize+split, multi-tab ──

  it("closing the middle-column tab compacts columns (no dead column)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical")); // +B(1,0)
    act(() => result.current.splitTab(a, "vertical")); // +C(1,0), B→(2,0)
    const c = result.current.state.activeTabId!;
    const b = result.current.state.tabs.find((t) => t.id !== a && t.id !== c)!.id;
    expect(result.current.state.layout!.columnCount).toBe(3);
    act(() => result.current.closeTab(c));
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.columnCount, "no empty column in the middle").toBe(2);
    expect(l.cells.find((x) => x.tabId === a)!.col).toBe(0);
    expect(l.cells.find((x) => x.tabId === b)!.col).toBe(1);
    expect(l.columnRatios.length).toBe(2);
  });

  it("closing the only tab of an intermediate row compacts rows (no dead row)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "horizontal")); // +B(0,1)
    act(() => result.current.splitTab(a, "horizontal")); // +C(0,1), B→(0,2)
    const c = result.current.state.activeTabId!;
    const b = result.current.state.tabs.find((t) => t.id !== a && t.id !== c)!.id;
    act(() => result.current.splitTab(a, "vertical")); // +D(1,0)
    expect(result.current.state.layout!.cells.length).toBe(4);
    act(() => result.current.closeTab(c));
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.cells.find((x) => x.tabId === b)!.row, "B moves up to the free row").toBe(1);
    const maxRow = Math.max(...l.cells.map((x) => x.row));
    const rows = new Set(l.cells.map((x) => x.row));
    expect(maxRow, "no empty row").toBe(rows.size - 1);
  });

  it("closing a pane of an L-shaped grid: survivors absorb the space (no holes)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical")); // A(0,0) B(1,0)
    const b = result.current.state.activeTabId!;
    act(() => result.current.splitTab(b, "horizontal")); // C(1,1), A grows to 2 rows
    const c = result.current.state.activeTabId!;
    expect(result.current.state.layout!.cells.length).toBe(3);
    act(() => result.current.closeTab(b));
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.cells.find((x) => x.tabId === a)).toMatchObject({ col: 0, row: 0, rowSpan: 2 });
    expect(l.cells.find((x) => x.tabId === c)).toMatchObject({ col: 1, row: 0, rowSpan: 2 });
  });

  it("closing the only cell of a column compacts that column (minimal movement)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical")); // A(0,0) B(1,0)
    const b = result.current.state.activeTabId!;
    act(() => result.current.splitTab(b, "vertical")); // C(2,0) → 3 columns
    const c = result.current.state.activeTabId!;
    act(() => result.current.closeTab(b)); // close the middle col
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    // Only the empty column compacts: A(0,0), C(1,0) — nobody else moves
    expect(l.columnCount).toBe(2);
    expect(l.cells.map((cell) => `${cell.col},${cell.row}`).sort()).toEqual(["0,0", "1,0"]);
  });

  it("splits never leave holes: neighbours stretch over the new line", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical")); // A(0,0) B(1,0)
    const b = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "horizontal")); // C(0,1); B spans both rows
    expectLayoutInvariant(result.current.state);
    expect(result.current.state.layout!.cells.find((x) => x.tabId === b)!.rowSpan).toBe(2);
    const c = result.current.state.activeTabId!;
    act(() => result.current.splitTab(c, "vertical"));
    const l = result.current.state.layout!;
    expect(l.cells.length).toBe(4);
    const cb = l.cells.find((x) => x.tabId === b)!;
    expect(cb.col + cb.colSpan, "B stays on the right edge").toBe(l.columnCount);
    expectLayoutInvariant(result.current.state);
  });

  it("resize + split: custom ratios are preserved, the new column enters with ratio 1", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical"));
    act(() => result.current.resizeColumns(0, 600, 1000)); // col1 to the 40px floor: [1.92, 0.08]
    const before = result.current.state.layout!.columnRatios;
    expect(before[0]).toBeGreaterThan(before[1]);
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical"));
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.columnRatios.length).toBe(3);
    expect(l.columnRatios[0]).toBe(before[0]);
    expect(l.columnRatios[1]).toBe(before[1]);
  });

  it("resize to the floor in wide windows preserves ratios across split (no false reset)", () => {
    // Regression: a min/max<2% heal used to nuke custom widths on containers
    // >=2040px, where a legit 40px column next to the maximized one is
    // numerically identical to the sliver (40/2560 = 1.59% vs disease 1.56%).
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical"));
    act(() => result.current.resizeColumns(0, 2520, 2560)); // col2 to the floor: [1.96875, 0.03125]
    const before = result.current.state.layout!.columnRatios;
    expect(before[1]).toBeCloseTo(0.03125, 5);
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical"));
    const l = result.current.state.layout!;
    expect(l.columnRatios[0]).toBe(before[0]);
    expect(l.columnRatios[1]).toBe(before[1]);
  });

  it("storm alternating tab AND direction (v on A, h on B, v on C…) keeps the invariant", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    let dir: "vertical" | "horizontal" = "vertical";
    for (let i = 0; i < 6; i++) {
      const active = result.current.state.activeTabId!;
      act(() => result.current.splitTab(active, dir));
      expectLayoutInvariant(result.current.state);
      dir = dir === "vertical" ? "horizontal" : "vertical";
    }
    expect(result.current.state.layout!.cells.length).toBe(7);
  });

  it("closing the SOURCE tab after a v-split dissolves the layout (1 inline left)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical"));
    act(() => result.current.closeTab(a));
    expect(result.current.state.layout).toBeNull();
    expect(result.current.state.tabs.length).toBe(1);
  });

  it("split with loose tabs open pairs ONLY with the new terminal", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const b = result.current.state.activeTabId!;
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const c = result.current.state.activeTabId!;
    expect(result.current.state.layout).toBeNull();
    act(() => result.current.setActiveTab(a));
    act(() => result.current.splitTab(a, "vertical"));
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.cells.length).toBe(2); // before: 4 cells in a 2×2 with a hole
    expect(l.cells.some((x) => x.tabId === b || x.tabId === c)).toBe(false);
    expect(l.columnCount).toBe(2);
  });

  it("the split menu: a chosen loose tab joins, others stay out; auto-arrange fills the area", () => {
    const { result } = setup();
    for (let i = 0; i < 5; i++) act(() => result.current.openTab({ profile: "code-assistant" }));
    const [a, b, c, d, e] = result.current.state.tabs.map((t) => t.id);
    act(() => result.current.setActiveTab(a));
    act(() => result.current.joinSplit(c)); // pair a + c, side by side on a wide area
    expectLayoutInvariant(result.current.state);
    expect(new Set(result.current.state.layout!.cells.map((c) => c.tabId))).toEqual(
      new Set([a, c]),
    );
    expect(result.current.state.layout!.columnCount).toBe(2);
    act(() => result.current.joinSplit(d)); // 3 → one large + two stacked
    act(() => result.current.joinSplit(e)); // 4 → 2 × 2 mosaic
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.columnCount).toBe(2);
    expect(Math.max(...l.cells.map((x) => x.row + x.rowSpan))).toBe(2);
    expect(l.cells.some((x) => x.tabId === b)).toBe(false); // b never chosen
    act(() => result.current.removeFromSplit(e));
    expectLayoutInvariant(result.current.state);
    expect(result.current.state.layout!.cells).toHaveLength(3);
    act(() => result.current.arrangeSplit("rows"));
    expect(result.current.state.layout!.columnCount).toBe(1);
    expectLayoutInvariant(result.current.state);
  });

  it("normalizeLayout removes cells for missing tabs after state drift", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical"));
    const state = result.current.state;
    const ghost = {
      ...state.layout!,
      cells: [
        ...state.layout!.cells,
        { id: "ghost", tabId: "missing-tab", col: 0, row: 9, colSpan: 1, rowSpan: 1 },
      ],
    };
    const cleaned = mod.normalizeLayout(state.tabs, ghost);
    expect(cleaned!.cells.length).toBe(2);
    expect(cleaned!.cells.every((c) => state.tabs.some((t) => t.id === c.tabId))).toBe(true);
  });

  it("splitTab does nothing for a detached tab", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.detachTab(a, "detached-x"));
    const before = JSON.stringify(result.current.state);
    act(() => result.current.splitTab(a, "vertical"));
    expect(JSON.stringify(result.current.state)).toBe(before);
  });

  it("closeTab of a NON-active tab keeps the active one and its cell", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical"));
    const b = result.current.state.activeTabId!;
    act(() => result.current.setActiveTab(a));
    act(() => result.current.closeTab(b));
    expect(result.current.state.activeTabId).toBe(a);
    expect(result.current.state.layout).toBeNull(); // 1 inline left
  });

  it("storm of 8 alternating v/h splits never breaks the invariant (no-loop)", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    for (let i = 0; i < 8; i++) {
      const active = result.current.state.activeTabId!;
      act(() => result.current.splitTab(active, i % 2 === 0 ? "vertical" : "horizontal"));
      expectLayoutInvariant(result.current.state);
    }
    expect(result.current.state.layout!.cells.length).toBe(9);
  });
});

describe("project groups (syncProjectGroups)", () => {
  const P1 = { id: "p1", name: "Alpha", cwd: "C:/alpha" };
  const P2 = { id: "p2", name: "Beta", cwd: "C:/beta" };

  it("startup tabs (default group) are adopted by the active project with their grid", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical"));
    act(() => mod.syncProjectGroups([P1, P2], "p1"));
    const s = result.current.state;
    expect(s.groups.map((g) => g.id)).toEqual(["p1", "p2"]);
    expect(s.activeGroupId).toBe("p1");
    expect(s.tabs.every((t) => t.groupId === "p1")).toBe(true);
    expect(s.layout!.cells.length).toBe(2);
    expectLayoutInvariant(s);
  });

  it("new terminals start in the active project's folder (explicit cwd wins)", () => {
    const { result } = setup();
    act(() => mod.syncProjectGroups([P1, P2], "p2"));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    expect(result.current.activeTab!.cwd).toBe("C:/beta");
    act(() =>
      result.current.openTab({
        profile: "code-assistant",
        title: "x",
        isAgent: false,
        cwd: "D:/other",
      }),
    );
    expect(result.current.activeTab!.cwd).toBe("D:/other");
  });

  it("switching projects swaps grids and restores the saved layout", () => {
    const { result } = setup();
    act(() => mod.syncProjectGroups([P1, P2], "p1"));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTab(a, "vertical")); // A B in p1
    act(() => mod.syncProjectGroups([P1, P2], "p2"));
    expect(result.current.state.layout).toBeNull();
    expect(result.current.inlineTabs.length).toBe(0);
    act(() => mod.syncProjectGroups([P1, P2], "p1"));
    const s = result.current.state;
    expect(s.activeGroupId).toBe("p1");
    expect(s.layout!.cells.length).toBe(2);
    expect(s.activeTabId).toBe(a);
  });

  it("a project keeps existing with zero terminals", () => {
    const { result } = setup();
    act(() => mod.syncProjectGroups([P1, P2], "p2"));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.closeTab(result.current.state.activeTabId!));
    const s = result.current.state;
    expect(s.groups.map((g) => g.id)).toEqual(["p1", "p2"]);
    expect(s.activeGroupId).toBe("p2");
    expect(s.activeTabId).toBeNull();
  });

  it("other projects' tabs never enter the active grid", () => {
    const { result } = setup();
    act(() => mod.syncProjectGroups([P1, P2], "p1"));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical")); // p1: 2
    act(() => mod.syncProjectGroups([P1, P2], "p2"));
    act(() => result.current.openTab({ profile: "code-assistant" })); // p2: 1
    expect(result.current.state.tabs.length).toBe(3);
    expect(result.current.inlineTabs.length).toBe(1);
    expect(result.current.inlineTabs[0].groupId).toBe("p2");
  });

  it("removing a project: closeGroup + sync drops it and its grid", () => {
    const { result } = setup();
    act(() => mod.syncProjectGroups([P1, P2], "p1"));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => mod.syncProjectGroups([P1, P2], "p2"));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.closeGroup("p1"));
    act(() => mod.syncProjectGroups([P2], "p2"));
    const s = result.current.state;
    expect(s.groups.map((g) => g.id)).toEqual(["p2"]);
    expect(s.tabs.every((t) => t.groupId === "p2")).toBe(true);
    expect(s.savedLayouts.p1).toBeUndefined();
  });

  it("removing the ACTIVE project restores the next project's own split grid", () => {
    const { result } = setup();
    act(() => mod.syncProjectGroups([P1, P2], "p2"));
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical")); // p2: 2 panes
    act(() => mod.syncProjectGroups([P1, P2], "p1"));
    act(() => result.current.openTab({ profile: "code-assistant" })); // p1 active, 1 tab
    act(() => result.current.closeGroup("p1"));
    act(() => mod.syncProjectGroups([P2], "p2"));
    const s = result.current.state;
    expect(s.activeGroupId).toBe("p2");
    expect(s.layout!.cells.length).toBe(2);
    expectLayoutInvariant(s);
  });

  it("re-syncing the same projects is a no-op (no re-render storm)", () => {
    const { result } = setup();
    act(() => mod.syncProjectGroups([P1, P2], "p1"));
    const before = result.current.state;
    act(() => mod.syncProjectGroups([{ ...P1 }, { ...P2 }], "p1"));
    expect(result.current.state).toBe(before);
  });
});

describe("internal split (tmux-style, zero holes)", () => {
  function expectNoGaps(state: TerminalState) {
    const l = state.layout!;
    const rowCount = Math.max(...l.cells.map((c) => c.row + c.rowSpan));
    for (let f = 0; f < rowCount; f++) {
      const inRow = l.cells.filter((c) => c.row <= f && f < c.row + c.rowSpan);
      const covered = new Set<number>();
      for (const c of inRow)
        for (let k = c.col; k < c.col + c.colSpan; k++) {
          expect(covered.has(k)).toBe(false); // no overlaps
          covered.add(k);
        }
      for (let k = 0; k < l.columnCount; k++) expect(covered.has(k)).toBe(true);
    }
  }

  it("the user photo: 3 stacked tabs, internal-v split of the top one → zero hole", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "horizontal")); // 2 rows
    const b = result.current.state.activeTabId!;
    act(() => result.current.setActiveTab(result.current.state.tabs[0].id));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "horizontal")); // 3 rows in column 0
    const s0 = result.current.state;
    // col 0: 3 stacked tabs; internal-v split of the top one
    const top = s0.layout!.cells.find((c) => c.row === 0)!.tabId;
    act(() => result.current.setActiveTab(top));
    act(() => result.current.splitTabInner(top, "vertical"));
    expectNoGaps(result.current.state);
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.cells.length).toBe(4);
    // the top one splits into 2 halves
    const row0 = l.cells.filter((c) => c.row === 0);
    expect(row0.length).toBe(2);
    expect(row0.map((c) => c.col).sort()).toEqual([0, 1]);
    // the ones below flex to fill the space without overlaps
    const below = l.cells.filter((c) => c.row > 0);
    expect(below.length).toBe(2);
    for (const c of below) {
      expect(c.rowSpan).toBe(1);
      expect(c.colSpan).toBeGreaterThanOrEqual(1);
      expect(c.col + c.colSpan).toBeLessThanOrEqual(2);
    }
  });

  it("full 2×2 grid: internal-v split targets a new column and stretches the edge neighbor", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical")); // A | D
    act(() => result.current.setActiveTab(result.current.state.tabs[0].id));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "horizontal")); // A above, B below
    const d = result.current.state.layout!.cells.find((c) => c.col === 1 && c.row === 0)!.tabId;
    act(() => result.current.setActiveTab(d));
    act(() => result.current.splitTab(d, "horizontal")); // F below D → full 2×2
    expect(result.current.state.layout!.cells.length).toBe(4);
    // activate the left tab (A) and internal split
    const left = result.current.state.layout!.cells.find((c) => c.col === 0 && c.row === 0)!.tabId;
    act(() => result.current.setActiveTab(left));
    act(() => result.current.splitTabInner(left, "vertical"));
    expectNoGaps(result.current.state);
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    expect(l.columnCount).toBe(3);
    expect(l.cells.length).toBe(5);
    const f = l.cells.find((c) => c.col === 1 && c.row === 1)!;
    expect(f.colSpan).toBe(2); // the right-edge neighbor covers the edge
  });

  it("internal-h split vertically stretches the bottom cell of the neighbor column", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "vertical")); // A | B
    const a = result.current.state.layout!.cells.find((c) => c.col === 0)!.tabId;
    act(() => result.current.setActiveTab(a));
    act(() => result.current.splitTabInner(a, "horizontal"));
    expectNoGaps(result.current.state);
    expectLayoutInvariant(result.current.state);
    const l = result.current.state.layout!;
    const d = l.cells.find((c) => c.col === 1)!;
    expect(d.rowSpan).toBe(2); // the neighbor spans top to bottom vertically
    const newRow = l.cells.find((c) => c.row === 1 && c.col === 0)!;
    expect(newRow).toBeDefined();
  });

  it("internal-h split with the bottom cell occupied → fallback to the normal split", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    act(() => result.current.splitTab(result.current.state.activeTabId!, "horizontal")); // A above, B below
    const a = result.current.state.layout!.cells.find((c) => c.row === 0)!.tabId;
    act(() => result.current.setActiveTab(a));
    act(() => result.current.splitTabInner(a, "horizontal"));
    expectLayoutInvariant(result.current.state);
    // fallback: the normal split shifts B down
    expect(result.current.state.layout!.cells.length).toBe(3);
  });

  it("no layout → the internal split behaves like the normal split", () => {
    const { result } = setup();
    act(() => result.current.openTab({ profile: "code-assistant" }));
    const a = result.current.state.activeTabId!;
    act(() => result.current.splitTabInner(a, "vertical"));
    expectLayoutInvariant(result.current.state);
    expect(result.current.state.layout!.cells.length).toBe(2);
    expect(result.current.state.layout!.columnCount).toBe(2);
  });
});
