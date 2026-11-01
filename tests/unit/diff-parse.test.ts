import { describe, it, expect } from "vitest";
import { parseDiff } from "@/git/model/diff-parse";

const SAMPLE = [
  "● GelArria <g@x.dev> · 2d8e796 · 1d",
  "Add font zoom",
  "",
  "diff --git a/x b/x",
  "--- a/x",
  "+++ b/x",
  "@@ -41,3 +41,3 @@ export function Row() {",
  "   return (",
  '-    "px-3 py-2.5",',
  '+    "px-3 py-2.5 transition-colors",',
  "   );",
  "@@ -78,2 +78,3 @@",
  "   a",
  "+  b",
  "   c",
].join("\n");

describe("parseDiff", () => {
  it("reads the commit header and totals", () => {
    const d = parseDiff(SAMPLE);
    expect(d).toMatchObject({
      author: "GelArria <g@x.dev>",
      hash: "2d8e796",
      age: "1d",
      subject: "Add font zoom",
      added: 2,
      removed: 1,
    });
    expect(d.hunks).toHaveLength(2);
  });

  it("numbers old/new lines per hunk", () => {
    const [h] = parseDiff(SAMPLE).hunks;
    expect(h.lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ["ctx", 41, 41],
      ["del", 42, undefined],
      ["add", undefined, 42],
      ["ctx", 43, 43],
    ]);
    expect(h.oldEnd).toBe(43);
  });

  it("marks the changed words of a del/add pair", () => {
    const [h] = parseDiff(SAMPLE).hunks;
    const add = h.lines[2];
    expect(add.text.slice(add.word![0], add.word![1])).toBe(" transition-colors");
  });

  it("falls back to raw text when there is no hunk, keeping every line", () => {
    expect(parseDiff("(no diff)").raw).toBe("(no diff)");
    const bin =
      "diff --git a/x.png b/x.png\nnew file mode 100644\nBinary files /dev/null and b/x.png differ";
    expect(parseDiff(bin).raw).toBe(bin);
  });

  it("does not count a second file's ---/+++ as changes", () => {
    const two = SAMPLE + "\ndiff --git a/y b/y\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-a\n+b";
    expect(parseDiff(two)).toMatchObject({ added: 3, removed: 2 });
  });
});
