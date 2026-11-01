import { describe, it, expect } from "vitest";
import { classify, relTime } from "@/git/data/git-bridge";

// porcelain XY: x = index, y = worktree, "??" = untracked, U = conflict
describe("git porcelain classify", () => {
  it("untracked only for ??", () => {
    expect(classify("??")).toBe("untracked");
  });

  it("index code dominates when staged", () => {
    expect(classify("M ")).toBe("modified");
    expect(classify("A ")).toBe("added");
    expect(classify("D ")).toBe("deleted");
    expect(classify("R ")).toBe("renamed");
    expect(classify("MM")).toBe("modified"); // staged + restaged edit → label from index
  });

  it("worktree code when only modified in place", () => {
    expect(classify(" M")).toBe("modified");
    expect(classify("AM")).toBe("added");
  });

  it("conflicts win over everything", () => {
    expect(classify("UU")).toBe("conflicted");
    expect(classify(" U")).toBe("conflicted");
  });

  it("unknown codes fall back to modified", () => {
    expect(classify("C ")).toBe("modified");
  });
});

describe("relTime abbreviation", () => {
  const now = 1_700_000_000_000; // ms
  const at = (s: number) => (now - s * 1000) / 1000; // unix seconds ago

  it("under a minute", () => {
    expect(relTime(at(30), now)).toBe("now");
  });

  it("minutes and hours", () => {
    expect(relTime(at(5 * 60), now)).toBe("5m");
    expect(relTime(at(3 * 3600), now)).toBe("3h");
  });

  it("days, weeks, months, years", () => {
    expect(relTime(at(2 * 86400), now)).toBe("2d");
    expect(relTime(at(2 * 604800), now)).toBe("2w");
    expect(relTime(at(4 * 2592000), now)).toBe("4mo");
    expect(relTime(at(2 * 31536000), now)).toBe("2y");
  });

  it("future timestamps clamp to now", () => {
    expect(relTime(at(-100), now)).toBe("now");
  });
});
