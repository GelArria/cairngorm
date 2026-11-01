import { describe, expect, it } from "vitest";
import { launchTarget, parentFolder, type LaunchRequest } from "@/app/model/launch-target";

const request = (patch: Partial<LaunchRequest>): LaunchRequest => ({
  path: null,
  isFile: false,
  terminal: false,
  agent: null,
  panel: null,
  settings: null,
  ...patch,
});

const projects = [
  { id: "app", rootPath: "C:\\work\\app" },
  { id: "web", rootPath: "C:\\work\\app\\web\\" },
  { id: "blank", rootPath: "" },
];

describe("cairngorm command routing", () => {
  it("opens nothing without a path", () => {
    expect(launchTarget(request({ settings: "providers" }), projects)).toBeNull();
  });

  it("switches to the project that owns the path, the deepest one first", () => {
    expect(launchTarget(request({ path: "c:/work/app" }), projects)).toEqual({
      projectId: "app",
      projectFolder: "c:/work/app",
      cwd: "c:/work/app",
    });
    expect(
      launchTarget(request({ path: "C:\\work\\app\\web\\src", terminal: true }), projects),
    ).toMatchObject({ projectId: "web", cwd: "C:\\work\\app\\web\\src" });
    expect(
      launchTarget(request({ path: "C:\\work\\app\\README.md", isFile: true }), projects),
    ).toMatchObject({ projectId: "app", cwd: "C:\\work\\app" });
  });

  it("does not mistake a sibling folder with a shared prefix for the project", () => {
    expect(launchTarget(request({ path: "C:\\work\\application" }), projects)).toEqual({
      projectId: null,
      projectFolder: "C:\\work\\application",
      cwd: "C:\\work\\application",
    });
  });

  it("creates a project on a loose file's folder", () => {
    expect(launchTarget(request({ path: "/home/me/notes/todo.md", isFile: true }), [])).toEqual({
      projectId: null,
      projectFolder: "/home/me/notes",
      cwd: "/home/me/notes",
    });
  });

  it("keeps drive and filesystem roots as folders", () => {
    expect(parentFolder("C:\\notes.md")).toBe("C:\\");
    expect(parentFolder("/notes.md")).toBe("/");
    expect(parentFolder("\\\\server\\share\\a.txt")).toBe("\\\\server\\share");
  });
});
