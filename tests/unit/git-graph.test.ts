import { describe, it, expect } from "vitest";
import { layoutGraph } from "@/git/model/git-graph";

describe("layoutGraph", () => {
  it("keeps a linear history in one lane", () => {
    const { rows, width } = layoutGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[0]).toMatchObject({ up: false, down: true });
    expect(rows[2]).toMatchObject({ up: true, down: false });
    expect(width).toBe(30);
  });

  it("opens a lane for a merge's second parent and closes it at the fork point", () => {
    // m merges f (feature) into main; both come from base
    const { rows, width } = layoutGraph([
      { hash: "m", parents: ["x", "f"] },
      { hash: "f", parents: ["base"] },
      { hash: "x", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    expect(rows[0]).toMatchObject({ lane: 0, forks: [1] });
    expect(rows[1].lane).toBe(1); // feature commit in its own lane
    expect(rows[2]).toMatchObject({ lane: 0, through: [1] });
    expect(rows[3]).toMatchObject({ lane: 0, merges: [1] }); // feature lane folds back
    expect(width).toBe(46);
  });

  it("gives an unmerged branch tip its own lane", () => {
    const { rows } = layoutGraph([
      { hash: "main2", parents: ["base"] },
      { hash: "fix", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    expect(rows[1]).toMatchObject({ lane: 1, up: false });
    expect(rows[2].merges).toEqual([1]);
  });
});
