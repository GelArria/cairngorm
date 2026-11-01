import { describe, it, expect } from "vitest";
import { terminalPlace } from "@/sidebar/hooks/use-workspace-label";

const ws = { root: "C:\\Users\\me\\proj", folder: "proj", branch: "main" };

describe("terminalPlace", () => {
  it("uses the workspace when the terminal has no cwd or sits at the root", () => {
    expect(terminalPlace(undefined, ws)).toEqual({ folder: "proj", branch: "main" });
    expect(terminalPlace("c:/users/me/proj/", ws)).toEqual({ folder: "proj", branch: "main" });
  });

  it("shows a subfolder by name and keeps the workspace branch", () => {
    expect(terminalPlace("C:\\Users\\me\\proj\\src-tauri", ws)).toEqual({
      folder: "src-tauri",
      branch: "main",
    });
  });

  it("shows an outside folder without the workspace's branch", () => {
    expect(terminalPlace("D:\\other\\repo", ws)).toEqual({ folder: "repo", branch: null });
    expect(terminalPlace("C:\\Users\\me\\proj-two", ws)).toEqual({
      folder: "proj-two",
      branch: null,
    });
  });
});
