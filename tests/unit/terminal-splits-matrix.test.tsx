// Exhaustive overlap battery: generated sequences of splits
// (normal/internal × vertical/horizontal) + interleaved closes over layouts
// ragged. After EVERY step it verifies: no rectangular overlaps, cells inside
// grid range, the active tab inside the group on screen, zero holes, complete
// ratios. Open tabs outside the group are valid (they are loose tabs).
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

let mod: typeof import("../../src/terminal/hooks/use-terminal-tabs");
beforeEach(async () => {
  vi.resetModules();
  mod = await import("../../src/terminal/hooks/use-terminal-tabs");
});

type SplitOp = "nv" | "nh" | "iv" | "ih";
type Op = SplitOp | "close" | "open";
const SPLIT_OPS: SplitOp[] = ["nv", "nh", "iv", "ih"];

// Deterministic PRNG (mulberry32) for reproducible sampling
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 61), t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

/** Violations of the state after each op. [] = healthy. */
function checkState(state: TerminalState): string[] {
  const errs: string[] = [];
  const inline = state.tabs.filter(
    (t) => !t.detached && (t.groupId ?? "g1") === state.activeGroupId,
  );
  if (!state.layout) {
    // Tabs mode (no layout) is valid: inactive tabs are reachable from the bar
    return errs;
  }
  const l = state.layout;
  if (l.cells.length < 2) errs.push(`group of ${l.cells.length}`);
  if (l.cells.length > inline.length)
    errs.push(`cells ${l.cells.length} > inline tabs ${inline.length}`);
  if (state.activeTabId && !l.cells.some((c) => c.tabId === state.activeTabId))
    errs.push(`active ${state.activeTabId} outside the group on screen`);
  const rows = Math.max(...l.cells.map((c) => c.row + c.rowSpan));
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < l.columnCount; k++)
      if (!l.cells.some((c) => overlaps(c, { col: k, row: r, colSpan: 1, rowSpan: 1 })))
        errs.push(`hole at ${k},${r}`);
  if (l.columnRatios.length !== l.columnCount) errs.push("ratios != columnCount");
  for (const c of l.cells) {
    if (c.col < 0 || c.col >= l.columnCount) errs.push(`col out of range ${JSON.stringify(c)}`);
    if (c.col + c.colSpan > l.columnCount) errs.push(`colSpan out of range ${JSON.stringify(c)}`);
    if (c.colSpan < 1 || c.rowSpan < 1) errs.push(`span < 1 ${JSON.stringify(c)}`);
    const tab = state.tabs.find((t) => t.id === c.tabId);
    if (!tab || tab.detached || (tab.groupId ?? "g1") !== state.activeGroupId)
      errs.push(`cell of a foreign tab ${c.tabId}`);
  }
  for (let i = 0; i < l.cells.length; i++)
    for (let j = i + 1; j < l.cells.length; j++)
      if (overlaps(l.cells[i], l.cells[j]))
        errs.push(`SOLAPE ${JSON.stringify(l.cells[i])} vs ${JSON.stringify(l.cells[j])}`);
  return errs;
}

function setup() {
  return renderHook(() => mod.useTerminalTabs());
}

/** Applies a full sequence to a clean instance; returns ALL violations. */
function runSequence(ops: Op[], rng: () => number): string[] {
  const { result } = setup();
  // The module singleton survives between sequences of the same it → reset it
  for (const t of [...result.current.state.tabs]) act(() => result.current.closeTab(t.id));
  act(() => result.current.openTab({ profile: "code-assistant" }));
  const errs: string[] = [];
  const inlineOf = (s: TerminalState) =>
    s.tabs.filter((t) => !t.detached && (t.groupId ?? "g1") === s.activeGroupId);
  for (const op of ops) {
    const s = result.current.state;
    const inline = inlineOf(s);
    if (op === "close") {
      if (inline.length >= 2) {
        const victim = inline[Math.floor(rng() * inline.length)];
        act(() => result.current.closeTab(victim.id));
      }
    } else if (op === "open") {
      act(() => result.current.openTab({ profile: "code-assistant" }));
    } else {
      if (!inline.length) continue;
      const target = inline[Math.floor(rng() * inline.length)];
      act(() => result.current.setActiveTab(target.id));
      const dir = op[1] === "v" ? "vertical" : "horizontal";
      if (op[0] === "n") act(() => result.current.splitTab(target.id, dir));
      else act(() => result.current.splitTabInner(target.id, dir));
    }
    for (const e of checkState(result.current.state))
      errs.push(`[${ops.join(" ")}] tras ${op}: ${e}`);
  }
  return errs;
}

function* product<T>(alphabet: T[], len: number, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === len) {
    yield prefix;
    return;
  }
  for (const a of alphabet) yield* product(alphabet, len, [...prefix, a]);
}

describe("exhaustive split matrix — no overlaps in any combination", () => {
  it("all sequences of 4 normal splits (2^4×... 256 combos)", () => {
    const failures: string[] = [];
    for (const seq of product(["nv", "nh"] as const, 4)) {
      failures.push(...runSequence([...seq], mulberry32(1)));
    }
    expect(failures, failures.slice(0, 5).join("\n")).toEqual([]);
  }, 180_000);

  it("all sequences of 4 internal splits (256 combos) keep the grid healthy", () => {
    const failures: string[] = [];
    for (const seq of product(["iv", "ih"] as const, 4)) {
      failures.push(...runSequence([...seq], mulberry32(2)));
    }
    expect(failures, failures.slice(0, 5).join("\n")).toEqual([]);
  }, 180_000);

  it("all sequences of 3 mixed normal/internal splits (64 combos)", () => {
    const failures: string[] = [];
    for (const seq of product(SPLIT_OPS, 3)) {
      failures.push(...runSequence([...seq], mulberry32(3)));
    }
    expect(failures, failures.slice(0, 5).join("\n")).toEqual([]);
  }, 180_000);

  it("long mixed sequences with interleaved closes (deterministic sampling, 300 combos)", () => {
    const rng = mulberry32(42);
    const alphabet: Op[] = [...SPLIT_OPS, "close", "open"];
    const failures: string[] = [];
    for (let i = 0; i < 300; i++) {
      const len = 4 + Math.floor(rng() * 4); // 4..7 ops
      const seq: Op[] = Array.from(
        { length: len },
        () => alphabet[Math.floor(rng() * alphabet.length)],
      );
      failures.push(...runSequence(seq, mulberry32(1000 + i)));
    }
    expect(failures, failures.slice(0, 5).join("\n")).toEqual([]);
  }, 240_000);

  it("closing after each split type leaves no overlaps or orphan cells", () => {
    const failures: string[] = [];
    for (const op of SPLIT_OPS) {
      // split → close one half → split again → close → open
      failures.push(...runSequence([op, "close", op, "close", "open", op], mulberry32(7)));
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("normalizeLayout clamps out-of-range colSpan values in corrupted legacy layouts", () => {
    const tabs = [
      { id: "a", detached: false, groupId: "g1" },
      { id: "b", detached: false, groupId: "g1" },
      { id: "c", detached: false, groupId: "g1" },
    ] as unknown as Parameters<typeof mod.normalizeLayout>[0];
    const corrupt = {
      cells: [
        { id: "1", tabId: "a", col: 0, row: 0, colSpan: 5, rowSpan: 1 }, // out of range
        { id: "2", tabId: "b", col: 1, row: 0, colSpan: 1, rowSpan: 1 },
        { id: "3", tabId: "c", col: 0, row: 1, colSpan: 1, rowSpan: 1 },
      ],
      columnCount: 2,
      columnRatios: [1, 1],
    } as unknown as TileLayout;
    const out = mod.normalizeLayout(tabs, corrupt);
    expect(out).not.toBeNull();
    for (const c of out!.cells) {
      expect(c.col + c.colSpan).toBeLessThanOrEqual(out!.columnCount);
      expect(c.col).toBeLessThanOrEqual(out!.columnCount - 1);
    }
  });

  it("finalizeLayout compacts dead columns (no cell or span covering them)", () => {
    // Stale-drop regression: dead col 1 among used {0,2,3} —
    // monotonic remap + survivors ratios in their original order.
    const layout = {
      cells: [
        { id: "1", tabId: "a", col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        { id: "2", tabId: "b", col: 0, row: 1, colSpan: 1, rowSpan: 1 },
        { id: "3", tabId: "c", col: 2, row: 0, colSpan: 1, rowSpan: 1 },
        { id: "4", tabId: "d", col: 3, row: 0, colSpan: 1, rowSpan: 1 },
      ],
      columnCount: 4,
      columnRatios: [2, 5, 3, 4],
    } as TileLayout;
    const out = mod.finalizeLayout(layout);
    expect(out.columnCount).toBe(3);
    expect(out.columnRatios).toEqual([2, 3, 4]); // the dead one (5) out, relative order intact
    expect(out.cells.map((c) => c.col).sort()).toEqual([0, 0, 1, 2]);
    for (const c of out.cells) expect(c.col + c.colSpan).toBeLessThanOrEqual(3);
  });
});
