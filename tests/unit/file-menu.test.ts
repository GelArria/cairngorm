import { describe, it, expect, vi } from "vitest";
import { buildFileMenu, type FileActions, type FileMenuTarget } from "@/workspace/model/file-menu";
import { baseName, copyName, dirName, joinPath } from "@/common/filesystem/fs-ops";
import { mergeLoaded } from "@/workspace/model/tree-utils";

const actions = (): FileActions => {
  const cache: Record<string, ReturnType<typeof vi.fn>> = {};
  return new Proxy({} as FileActions, { get: (_t, k) => (cache[String(k)] ??= vi.fn()) });
};
const labels = (t: Partial<FileMenuTarget>) =>
  buildFileMenu({ kind: "file", onDisk: true, inRepo: true, canPaste: false, ...t }, actions()).map(
    (i) => (i.separator ? "—" : i.label),
  );

describe("buildFileMenu", () => {
  it("file row: Zed layout, grouped by separators", () => {
    expect(labels({})).toEqual([
      "Open",
      "Open in Split",
      "—",
      "New File",
      "New Folder",
      "—",
      "Reveal in File Explorer",
      "Open in Default App",
      "Open in Terminal",
      "—",
      "Cut",
      "Copy",
      "Duplicate",
      "Paste",
      "—",
      "Copy Path",
      "Copy Relative Path",
      "—",
      "Add to .gitignore",
      "Add to .git/info/exclude",
      "—",
      "Rename…",
      "Delete",
      "—",
      "Collapse All",
    ]);
  });

  it("folder row adds Find in Folder and Expand All, no Open", () => {
    const l = labels({ kind: "folder" });
    expect(l).toContain("Find in Folder…");
    expect(l).toContain("Expand All");
    expect(l).not.toContain("Open");
  });

  it("tree background only offers creation, paste and tree-wide actions", () => {
    expect(labels({ kind: "root", inRepo: false })).toEqual([
      "New File",
      "New Folder",
      "—",
      "Reveal in File Explorer",
      "Open in Terminal",
      "—",
      "Find in Folder…",
      "—",
      "Paste",
      "—",
      "Expand All",
      "Collapse All",
    ]);
  });

  it("hides git entries outside a repo; Paste is disabled until something is copied", () => {
    expect(labels({ inRepo: false })).not.toContain("Add to .gitignore");
    const off = buildFileMenu(
      { kind: "file", onDisk: true, inRepo: false, canPaste: false },
      actions(),
    );
    expect(off.find((i) => i.label === "Paste")?.disabled).toBe(true);
    const on = buildFileMenu(
      { kind: "file", onDisk: true, inRepo: false, canPaste: true },
      actions(),
    );
    expect(on.find((i) => i.label === "Paste")?.disabled).toBe(false);
  });

  it("in-memory files (no folder on disk) get no disk operations", () => {
    expect(labels({ onDisk: false })).toEqual(["Open", "—", "Copy Path"]);
  });

  it("Delete is danger-styled and wired to remove()", () => {
    const a = actions();
    const del = buildFileMenu(
      { kind: "file", onDisk: true, inRepo: false, canPaste: false },
      a,
    ).find((i) => i.label === "Delete")!;
    expect(del.danger).toBe(true);
    del.action();
    expect(a.remove).toHaveBeenCalledTimes(1);
  });
});

describe("fs-ops path helpers", () => {
  it("joins with the separator the base already uses", () => {
    expect(joinPath(String.raw`C:\proj\ `.trim(), "src", "a.ts")).toBe(
      String.raw`C:\proj\src\a.ts`,
    );
    expect(joinPath("/home/u/", "src")).toBe("/home/u/src");
  });
  it("base / dir names", () => {
    expect(baseName(String.raw`C:\proj\src\a.ts`)).toBe("a.ts");
    expect(dirName(String.raw`C:\proj\src\a.ts`)).toBe(String.raw`C:\proj\src`);
    expect(dirName("/a/b/")).toBe("/a");
  });
  it("copyName keeps the extension and numbers further copies", () => {
    const taken = new Set(["a copy.txt"]);
    expect(copyName("a.txt", (n) => taken.has(n))).toBe("a copy 2.txt");
    expect(copyName("Makefile", () => false)).toBe("Makefile copy");
    expect(copyName(".env", () => false)).toBe(".env copy");
  });
});

describe("mergeLoaded", () => {
  it("keeps already-loaded children of folders that survive a refresh", () => {
    const old = [
      { name: "src", type: "folder" as const, children: [{ name: "a.ts", type: "file" as const }] },
    ];
    const fresh = [
      { name: "src", type: "folder" as const, children: [] },
      { name: "new.md", type: "file" as const },
    ];
    const merged = mergeLoaded(old, fresh);
    expect(merged[0].children?.[0].name).toBe("a.ts");
    expect(merged[1].name).toBe("new.md");
  });
});
