import { describe, expect, it } from "vitest";
import { dockLayout } from "../../src/terminal/model/dock-layout";
import { normalizeLayout } from "../../src/terminal/model/layout/normalize";
import { getRowRatios, resizeTrackRatios } from "../../src/terminal/model/layout/track-sizing";
import type { TermTab, TileLayout } from "../../src/terminal/model/types";

const stacked: TileLayout = {
  columnCount: 1,
  columnRatios: [1],
  rowRatios: [2, 1, 3],
  cells: [0, 1, 2].map((row) => ({
    id: `c${row}`,
    tabId: `t${row}`,
    col: 0,
    row,
    colSpan: 1,
    rowSpan: 1,
  })),
};

describe("pane track sizing", () => {
  it("defaults legacy rows and newly added rows to equal weights", () => {
    expect(getRowRatios({ ...stacked, rowRatios: undefined })).toEqual([1, 1, 1]);
    expect(getRowRatios({ ...stacked, rowRatios: [2, 1] })).toEqual([2, 1, 1]);
  });

  it("transfers pixels only between the tracks touching the selected boundary", () => {
    const ratios = [1, 2, 1];
    expect(resizeTrackRatios(ratios, 1, 100, 1000)).toEqual([1, 2.4, 0.6000000000000001]);
    expect(ratios).toEqual([1, 2, 1]);
  });

  it("keeps 40px minimum tracks in either direction and a constant total", () => {
    for (const delta of [-10000, 10000]) {
      const ratios = resizeTrackRatios([1, 1], 0, delta, 1000);
      expect((Math.min(...ratios) / 2) * 1000).toBeCloseTo(40);
      expect(ratios.reduce((a, b) => a + b)).toBeCloseTo(2);
    }
    expect(resizeTrackRatios([1, 1], 0, 100, 50)).toEqual([1, 1]);
  });

  it("ignores invalid indices, deltas and container sizes", () => {
    const ratios = [1, 1];
    for (const index of [-1, 1, 0.5, NaN]) {
      expect(resizeTrackRatios(ratios, index, 20, 1000)).toBe(ratios);
    }
    expect(resizeTrackRatios(ratios, 0, NaN, 1000)).toBe(ratios);
    expect(resizeTrackRatios(ratios, 0, 20, 0)).toBe(ratios);
  });

  it("preserves heights when normalizing and removes a closed row's weight", () => {
    const tabs: TermTab[] = [0, 2].map((n) => ({
      id: `t${n}`,
      sessionId: `s${n}`,
      title: `Terminal ${n}`,
      profile: "code-assistant",
      status: "running",
      detached: false,
    }));
    expect(normalizeLayout(tabs, stacked)?.rowRatios).toEqual([2, 3]);
  });

  it("retains heights on column docking and inserts the target height on row docking", () => {
    const right = dockLayout(
      stacked,
      "new",
      "t1",
      "right",
      () => "new-cell",
      () => {},
    )!;
    expect(right.rowRatios).toEqual([2, 1, 3]);
    const below = dockLayout(
      stacked,
      "new",
      "t1",
      "bottom",
      () => "new-cell",
      () => {},
    )!;
    expect(below.rowRatios).toEqual([2, 1, 1, 3]);
    expect(stacked.rowRatios).toEqual([2, 1, 3]);
  });
});
