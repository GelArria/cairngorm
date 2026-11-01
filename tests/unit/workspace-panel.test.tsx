import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/preact";
import { WorkspacePanel } from "@/workspace/workspace-panel";
import { removeNodeAtPath, addChildAtPath, moveNode } from "@/workspace/model/tree-utils";
import type { FileNode } from "@/workspace/model/types";

const mockReadFileContent = vi.fn().mockResolvedValue("file-content");
const mockListen = vi.fn().mockResolvedValue(vi.fn());

vi.mock("@/common/filesystem/fs-bridge", () => ({
  openFolderDialog: vi.fn().mockResolvedValue(null),
  readFileContent: (...a: unknown[]) => mockReadFileContent(...a),
  listDir: vi.fn().mockResolvedValue([]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...a: unknown[]) => mockListen(...a),
}));

const sampleTree: FileNode[] = [
  { name: "src", type: "folder", children: [{ name: "index.ts", type: "file", size: "1k" }] },
  { name: "package.json", type: "file", size: "0.8k" },
];

describe("WorkspacePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockReadFileContent.mockResolvedValue("file-content");
    mockListen.mockResolvedValue(vi.fn());
  });

  it("renders workspace panel (no project yet → no folder)", () => {
    const { container } = render(<WorkspacePanel />);
    expect(container.textContent).toContain("No folder");
  });

  it("container div has NO onDrop/onDragOver/onDragLeave attributes", () => {
    const { container } = render(<WorkspacePanel />);
    const main = container.querySelector("[class*='flex-col']") as HTMLElement;
    expect(main?.getAttribute("ondrop")).toBeNull();
    expect(main?.getAttribute("ondragover")).toBeNull();
    expect(main?.getAttribute("ondragleave")).toBeNull();
  });

  it("leaves OS drops and pastes to App (no duplicate handling — it is mounted twice)", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    render(<WorkspacePanel />);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockListen).not.toHaveBeenCalledWith("os-file-drop", expect.any(Function));
    expect(addSpy).not.toHaveBeenCalledWith("app-paste-files", expect.any(Function));
    expect(addSpy).not.toHaveBeenCalledWith("workspace-open-file", expect.any(Function));
    addSpy.mockRestore();
  });

  it("tree-utils: removeNodeAtPath removes correct node", () => {
    const result = removeNodeAtPath(sampleTree, ["package.json"]);
    expect(result.length).toBe(1);
  });

  it("tree-utils: addChildAtPath adds new file to tree", () => {
    const child: FileNode = { name: "README.md", type: "file", size: "0.3k" };
    const result = addChildAtPath(sampleTree, [], child);
    expect(result.length).toBe(3);
  });

  it("tree-utils: moveNode preserves the moved file and other nodes", () => {
    const result = moveNode(sampleTree, ["package.json"], ["src"]);
    const src = result.find((n) => n.name === "src")!;
    expect(src.children!.find((n) => n.name === "index.ts")).toBeTruthy();
    expect(src.children!.find((n) => n.name === "package.json")).toBeTruthy();
    expect(result.find((n) => n.name === "package.json")).toBeUndefined();
  });
});
