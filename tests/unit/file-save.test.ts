import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/common/filesystem/fs-bridge", () => ({ writeFileContent: vi.fn() }));
vi.mock("@/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));

let actions: typeof import("@/terminal/state/file-actions");
let store: typeof import("@/terminal/state/terminal-store");
let write: typeof import("@/common/filesystem/fs-bridge").writeFileContent;

beforeEach(async () => {
  vi.resetModules();
  actions = await import("@/terminal/state/file-actions");
  store = await import("@/terminal/state/terminal-store");
  ({ writeFileContent: write } = await import("@/common/filesystem/fs-bridge"));
  vi.mocked(write).mockReset().mockResolvedValue(true);
});

const open = (
  title = "SKILL.md",
  fullPath: string | undefined = "C:/skills/review/SKILL.md",
  extension = "md",
) => actions.openFileTab({ title, path: [title], fullPath, extension, content: "original" });

describe("file saving", () => {
  it("saves the specified pane, not a different active file", async () => {
    const skill = open();
    actions.updateFileContent(skill, "updated skill");
    const other = open("other.md", "C:/other.md");
    actions.updateFileContent(other, "unsaved other file");
    await actions.saveFileTab(skill);
    expect(write).toHaveBeenCalledWith("C:/skills/review/SKILL.md", "updated skill");
    expect(store.getTerminalTab(skill)?.isDirty).toBe(false);
    expect(store.getTerminalTab(other)?.isDirty).toBe(true);
  });

  it("reads the latest active content for the keyboard/menu save", async () => {
    const skill = open();
    actions.updateFileContent(skill, "latest");
    await actions.saveFileTab();
    expect(write).toHaveBeenCalledWith("C:/skills/review/SKILL.md", "latest");
    expect(store.getTerminalTab(skill)?.isDirty).toBe(false);
  });

  it("keeps new edits dirty when an earlier write completes", async () => {
    let finish!: (ok: boolean) => void;
    vi.mocked(write).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const skill = open();
    actions.updateFileContent(skill, "first");
    const saving = actions.saveFileTab(skill);
    actions.updateFileContent(skill, "second");
    finish(true);
    await saving;
    expect(store.getTerminalTab(skill)?.content).toBe("second");
    expect(store.getTerminalTab(skill)?.isDirty).toBe(true);
  });

  it("keeps the draft dirty and propagates write failures", async () => {
    vi.mocked(write).mockRejectedValue(new Error("Permission denied"));
    const skill = open();
    actions.updateFileContent(skill, "keep this draft");
    await expect(actions.saveFileTab(skill)).rejects.toThrow("Permission denied");
    expect(store.getTerminalTab(skill)?.isDirty).toBe(true);
    expect(store.getTerminalTab(skill)?.content).toBe("keep this draft");
  });

  it("does not overwrite previews or documents without a disk path", async () => {
    const untitled = actions.openFileTab({
      title: "Untitled",
      path: ["Untitled"],
      content: "draft",
    });
    await actions.saveFileTab(untitled);
    for (const ext of ["pdf", "xlsx", "png", "diff", "git-graph", "git-commit"]) {
      await actions.saveFileTab(open(`file.${ext}`, `C:/file.${ext}`, ext));
    }
    expect(write).not.toHaveBeenCalled();
  });
});
