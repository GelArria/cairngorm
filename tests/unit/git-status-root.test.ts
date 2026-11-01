import { afterEach, beforeEach, expect, it, vi } from "vitest";
const workspace = vi.hoisted(() => ({ root: null as string | null }));
vi.mock("../../src/common/filesystem/workspace-root", () => ({
  getWorkspaceRootPath: () => workspace.root,
}));
vi.mock("../../src/git/data/git-bridge", async (original) => ({
  ...(await original<typeof import("../../src/git/data/git-bridge")>()),
  gitStatus: vi.fn(),
  gitBranch: vi.fn(),
  gitRepoRoot: vi.fn(),
  gitLog: vi.fn(),
  gitFileDetails: vi.fn(),
  gitStage: vi.fn(),
}));
import { getGitState, refreshGit, stageFiles } from "../../src/git/hooks/use-git-status";
import {
  gitStatus,
  gitBranch,
  gitRepoRoot,
  gitLog,
  gitFileDetails,
  gitStage,
} from "../../src/git/data/git-bridge";
beforeEach(() => {
  vi.mocked(gitStatus).mockResolvedValue({ files: [], error: null });
  vi.mocked(gitBranch).mockImplementation(async (root) => root);
  vi.mocked(gitRepoRoot).mockImplementation(async (root) => root);
  vi.mocked(gitLog).mockResolvedValue([]);
  vi.mocked(gitFileDetails).mockResolvedValue([]);
});
afterEach(async () => {
  workspace.root = null;
  await refreshGit(true);
  vi.resetAllMocks();
});

it("clears the previous footer immediately on project change and ignores late status replies", async () => {
  workspace.root = "C:/old";
  await refreshGit(true);
  let finish!: (value: Awaited<ReturnType<typeof gitStatus>>) => void;
  vi.mocked(gitStatus).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const stale = refreshGit(true);
  workspace.root = "C:/new";
  const current = refreshGit(true);
  expect(getGitState().branch).toBeNull();
  expect(getGitState().files).toEqual([]);
  await current;
  finish({ files: [{ path: "old.txt", code: "M " }], error: null });
  await stale;
  expect(getGitState().branch).toBe("C:/new");
  expect(getGitState().files).toEqual([]);
});

it("a late staging report never replaces a different project's changes", async () => {
  workspace.root = "C:/old";
  await refreshGit(true);
  let finish!: (value: Awaited<ReturnType<typeof gitStage>>) => void;
  vi.mocked(gitStage).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const staging = stageFiles(["old.txt"]);
  workspace.root = "C:/new";
  await refreshGit(true);
  finish({ files: [{ path: "old.txt", code: "M " }], error: null });
  await staging;
  expect(getGitState().root).toBe("C:/new");
  expect(getGitState().files).toEqual([]);
});

it("a failed status read is not a clean working tree until a status succeeds", async () => {
  workspace.root = "C:/repo";
  vi.mocked(gitStatus).mockResolvedValueOnce({
    files: [],
    error: "git spawn failed: program not found",
  });
  await refreshGit(true);
  expect(getGitState()).toMatchObject({ files: [], statusFailed: true });
  // A failed action keeps the unknown state; a fresh report (here: clean) clears it.
  vi.mocked(gitStage).mockResolvedValueOnce({ files: [], error: "git spawn failed" });
  await stageFiles([]);
  expect(getGitState().statusFailed).toBe(true);
  await refreshGit(true);
  expect(getGitState()).toMatchObject({ files: [], error: null, statusFailed: false });
});
