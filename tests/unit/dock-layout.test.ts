import { describe, it, expect } from "vitest";
import { dockEdgeAt, dockLayout } from "../../src/terminal/model/dock-layout";
import { fillHoles } from "../../src/terminal/hooks/use-terminal-tabs";
import type { TileCell, TileLayout } from "../../src/terminal/model/types";

let n = 0;
const id = () => `c${++n}`;
const cell = (tabId: string, col: number, row: number, colSpan = 1, rowSpan = 1): TileCell => ({
  id: id(),
  tabId,
  col,
  row,
  colSpan,
  rowSpan,
});
const at = (l: TileLayout, tab: string) => l.cells.find((c) => c.tabId === tab)!;

/** Every grid slot covered exactly once. */
function expectTiled(l: TileLayout) {
  const rows = Math.max(...l.cells.map((c) => c.row + c.rowSpan));
  const seen = new Map<string, string>();
  for (const c of l.cells)
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let k = c.col; k < c.col + c.colSpan; k++) {
        const key = `${k},${r}`;
        expect(seen.has(key), `overlap at ${key}`).toBe(false);
        seen.set(key, c.tabId);
      }
  expect(seen.size, "holes in the grid").toBe(l.columnCount * rows);
  expect(l.columnRatios).toHaveLength(l.columnCount);
}

describe("dockEdgeAt", () => {
  const r = { left: 0, top: 0, width: 100, height: 100 };
  it("centre box and nearest edge", () => {
    expect(dockEdgeAt(r, 50, 50)).toBe("center");
    expect(dockEdgeAt(r, 90, 50)).toBe("right");
    expect(dockEdgeAt(r, 10, 40)).toBe("left");
    expect(dockEdgeAt(r, 45, 5)).toBe("top");
    expect(dockEdgeAt(r, 60, 97)).toBe("bottom");
  });
});

describe("dockLayout", () => {
  it("single view → two panes side by side / stacked", () => {
    const right = dockLayout(null, "B", "A", "right", id, fillHoles)!;
    expect(at(right, "A")).toMatchObject({ col: 0, row: 0 });
    expect(at(right, "B")).toMatchObject({ col: 1, row: 0 });
    expectTiled(right);
    const top = dockLayout(null, "B", "A", "top", id, fillHoles)!;
    expect(at(top, "B")).toMatchObject({ col: 0, row: 0 });
    expect(at(top, "A")).toMatchObject({ col: 0, row: 1 });
    expectTiled(top);
  });

  it("moving a pane inside a split: A|B|C, dock C below A", () => {
    const l: TileLayout = {
      cells: [cell("A", 0, 0), cell("B", 1, 0), cell("C", 2, 0)],
      columnCount: 3,
      columnRatios: [1, 1, 1],
    };
    const out = dockLayout(l, "C", "A", "bottom", id, fillHoles)!;
    expect(at(out, "C")).toMatchObject({ col: 0, row: 1, colSpan: 1 });
    expect(at(out, "A")).toMatchObject({ col: 0, row: 0 });
    expectTiled(out);
  });

  it("every edge of every pane keeps the grid tiled (2×2 with a tall pane)", () => {
    const base: TileLayout = {
      cells: [cell("A", 0, 0, 1, 2), cell("B", 1, 0), cell("C", 1, 1)],
      columnCount: 2,
      columnRatios: [1, 1],
    };
    const tabs = ["A", "B", "C", "D"];
    for (const drag of tabs)
      for (const target of tabs.slice(0, 3))
        for (const edge of ["left", "right", "top", "bottom"] as const) {
          if (drag === target) continue;
          const src = drag === "D" ? base : base; // D = a tab that was not on screen
          const out = dockLayout(src, drag, target, edge, id, fillHoles);
          expect(out, `${drag}→${edge} of ${target}`).not.toBeNull();
          expectTiled(out!);
          const d = at(out!, drag),
            t = at(out!, target);
          if (edge === "right") expect(d.col).toBe(t.col + t.colSpan);
          if (edge === "left") expect(d.col + d.colSpan).toBe(t.col);
          if (edge === "bottom") expect(d.row).toBe(t.row + t.rowSpan);
          if (edge === "top") expect(d.row + d.rowSpan).toBe(t.row);
        }
  });

  it("returns null when the target has no cell", () => {
    expect(
      dockLayout(
        { cells: [cell("A", 0, 0)], columnCount: 1, columnRatios: [1] },
        "B",
        "Z",
        "left",
        id,
        fillHoles,
      ),
    ).toBeNull();
  });
});
