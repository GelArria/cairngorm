import { describe, it, expect } from "vitest";
import { splitGrouping } from "../../src/terminal/model/tab-grouping";
import type { TermTab, TileLayout } from "../../src/terminal/model/types";

const tab = (id: string, opts: Partial<TermTab> = {}): TermTab => ({
  id,
  title: id,
  profile: "code-assistant",
  status: "running",
  sessionId: "s-" + id,
  detached: false,
  isAgent: false,
  ...opts,
});

const layout = (cells: Array<[string, number, number]>, columnCount = 2): TileLayout => ({
  columnCount,
  columnRatios: Array.from({ length: columnCount }, () => 1),
  cells: cells.map(([tabId, col, row], i) => ({
    id: String(i),
    tabId,
    col,
    row,
    colSpan: 1,
    rowSpan: 1,
  })),
});

describe("splitGrouping", () => {
  it("no layout → null (renders as today)", () => {
    const tabs = [tab("1"), tab("2")];
    expect(splitGrouping(tabs, null)).toBeNull();
  });

  it("with layout: members in grid order (col,row), not array order", () => {
    // array: [agent1, shell, agent3]; grid: agent1 col0, agent3 col1
    const tabs = [tab("1"), tab("2"), tab("3")];
    const g = splitGrouping(
      tabs,
      layout([
        ["1", 0, 0],
        ["3", 1, 0],
      ]),
    );
    expect(g).not.toBeNull();
    expect(g!.members.map((t) => t.id)).toEqual(["1", "3"]);
    expect(g!.others.map((t) => t.id)).toEqual(["2"]);
  });

  it("reads the grid in reading order: col asc, then row asc", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    const g = splitGrouping(
      tabs,
      layout([
        ["c", 1, 0],
        ["a", 0, 0],
        ["b", 0, 1],
      ]),
    );
    expect(g!.members.map((t) => t.id)).toEqual(["a", "c", "b"]);
  });

  it("detached tabs are never split members", () => {
    const tabs = [
      tab("1"),
      tab("d", { detached: true, detachedWindowLabel: "detached-1" }),
      tab("2"),
    ];
    const g = splitGrouping(
      tabs,
      layout([
        ["1", 0, 0],
        ["2", 1, 0],
      ]),
    );
    expect(g!.members.map((t) => t.id)).toEqual(["1", "2"]);
    expect(g!.others.map((t) => t.id)).toEqual(["d"]);
  });
});
