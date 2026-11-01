import { describe, expect, it } from "vitest";
import { arrangeLayout, type ArrangeMode } from "../../src/terminal/model/layout/arrange";
import { tabBarSegments } from "../../src/terminal/model/tab-grouping";
import type { TermTab, TileLayout } from "../../src/terminal/model/types";

let n = 0;
const id = () => String(++n);
const ids = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`);
const rows = (l: TileLayout) => Math.max(...l.cells.map((c) => c.row + c.rowSpan));

function expectFull(l: TileLayout) {
  const covered = new Set<string>();
  for (const c of l.cells)
    for (let r = c.row; r < c.row + c.rowSpan; r++)
      for (let k = c.col; k < c.col + c.colSpan; k++) {
        expect(covered.has(`${k},${r}`), `overlap at ${k},${r}`).toBe(false);
        covered.add(`${k},${r}`);
      }
  expect(covered.size, "holes").toBe(l.columnCount * rows(l));
}

describe("arrangeLayout", () => {
  it("auto, 2 panes: side by side on a wide area, stacked on a tall one", () => {
    expect(arrangeLayout(ids(2), "auto", 16 / 9, id)!.columnCount).toBe(2);
    const tall = arrangeLayout(ids(2), "auto", 0.7, id)!;
    expect(tall.columnCount).toBe(1);
    expect(rows(tall)).toBe(2);
  });

  it("auto, 3 panes: one large pane plus two stacked", () => {
    const wide = arrangeLayout(ids(3), "auto", 1.6, id)!;
    expect(wide.cells[0]).toMatchObject({ col: 0, row: 0, rowSpan: 2 });
    const tall = arrangeLayout(ids(3), "auto", 0.8, id)!;
    expect(tall.cells[0]).toMatchObject({ col: 0, row: 0, colSpan: 2 });
    expect(arrangeLayout(ids(3), "auto", 3, id)!.columnCount).toBe(3); // ultra-wide
  });

  it("auto, 4 panes: 2 × 2 mosaic", () => {
    const l = arrangeLayout(ids(4), "auto", 16 / 9, id)!;
    expect([l.columnCount, rows(l)]).toEqual([2, 2]);
  });

  it("every mode and count fills the whole area with no overlap", () => {
    const modes: ArrangeMode[] = ["auto", "columns", "rows", "grid"];
    for (const mode of modes)
      for (let count = 2; count <= 9; count++)
        for (const aspect of [0.5, 1, 16 / 9, 3]) {
          const l = arrangeLayout(ids(count), mode, aspect, id)!;
          expect(l.cells).toHaveLength(count);
          expect(l.columnRatios).toHaveLength(l.columnCount);
          expectFull(l);
        }
  });

  it("a single pane is not a split", () => {
    expect(arrangeLayout(["a"], "auto", 1, id)).toBeNull();
  });
});

describe("tabBarSegments", () => {
  const tab = (tabId: string): TermTab =>
    ({ id: tabId, title: tabId, sessionId: tabId, detached: false }) as TermTab;
  const group = (...tabIds: string[]): TileLayout => arrangeLayout(tabIds, "columns", 2, id)!;

  it("each group is one block where its first member sits; loose tabs stay single", () => {
    const tabs = ["a", "b", "c", "d", "e"].map(tab);
    const shown = group("b", "d");
    const segments = tabBarSegments(tabs, [shown, group("c", "e")], shown);
    expect(
      segments.map((s) =>
        s.kind === "tab"
          ? s.tab.id
          : `[${s.members.map((t) => t.id).join("")}${s.shown ? "*" : ""}]`,
      ),
    ).toEqual(["a", "[bd*]", "[ce]"]);
  });
});
