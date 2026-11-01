import { describe, it, expect } from "vitest";
import { nameProblem } from "@/common/filesystem/fs-ops";

describe("nameProblem", () => {
  it("accepts ordinary names", () => {
    for (const n of ["README.md", ".gitignore", "my file.txt", "a-b_c.d.e", "console.log.ts"])
      expect(nameProblem(n)).toBeUndefined();
  });

  it("rejects separators, reserved characters and control chars", () => {
    for (const n of ["a/b", "a\\b", "a:b", "a*", "a?", 'a"b', "a<b", "a>b", "a|b", "a\u0001b"])
      expect(nameProblem(n)).toBeTruthy();
  });

  it("rejects dot names, trailing dot / space and Windows device names", () => {
    for (const n of [".", "..", "foo.", "foo ", "NUL", "con", "COM1.txt", "lpt9"])
      expect(nameProblem(n)).toBeTruthy();
    expect(nameProblem("com10")).toBeUndefined(); // only COM1-9 are devices
  });
});
