import { expect, it } from "vitest";
import { parseDiff, splitDiffLines } from "../../src/git/model/diff-parse";

it("aligns replacements, additions and deletions without losing context or line numbers", () => {
  const diff = parseDiff(
    "@@ -2,5 +2,5 @@\n context\n-old one\n-old two\n+new one\n context two\n+extra\n context three\n",
  );
  const rows = splitDiffLines(diff.hunks[0].lines);
  expect(rows.map((r) => [r.before?.text, r.after?.text])).toEqual([
    ["context", "context"],
    ["old one", "new one"],
    ["old two", undefined],
    ["context two", "context two"],
    [undefined, "extra"],
    ["context three", "context three"],
  ]);
  expect(rows.map((r) => [r.before?.old, r.after?.new])).toEqual([
    [2, 2],
    [3, 3],
    [4, undefined],
    [5, 4],
    [undefined, 5],
    [6, 6],
  ]);
  expect([diff.added, diff.removed]).toEqual([2, 2]);
});
