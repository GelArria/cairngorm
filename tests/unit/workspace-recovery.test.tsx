import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { WorkspacePanel } from "@/workspace/workspace-panel";
import type { SearchMatch } from "@/common/filesystem/fs-bridge";

const state = vi.hoisted(() => ({
  project: { id: "alpha", rootPath: "C:/alpha" } as { id: string; rootPath: string } | null,
  list: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/projects/api", () => ({
  useActiveProject: () => state.project,
  setProjectRoot: vi.fn(),
}));
vi.mock("@/git/hooks/use-git-status", () => ({
  getGitState: () => ({ repo: false, repoRoot: null, files: [] }),
  subscribeGit: () => () => {},
}));
vi.mock("@/common/filesystem/fs-bridge", () => ({
  openFolderDialog: vi.fn().mockResolvedValue(null),
  listDir: (...args: unknown[]) => state.list(...args),
  readFileContent: (...args: unknown[]) => state.read(...args),
}));
vi.mock("@/common/branding/", () => ({
  CairngormLoader: () => <div>Loading folder</div>,
  useLoaderGate: (loading: boolean) => loading,
}));
vi.mock("@/search", () => ({ setGlobalSearchRootPath: vi.fn(), openGlobalSearch: vi.fn() }));
vi.mock("@/workspace/components/workspace-search", () => ({
  WorkspaceSearch: ({ onOpenMatch }: { onOpenMatch: (m: SearchMatch, q: string) => void }) => (
    <button
      onClick={() =>
        onOpenMatch(
          {
            path: "C:/alpha/missing.ts",
            line: 4,
            col: 1,
            lineText: "needle",
            matchStart: 0,
            matchEnd: 6,
            contextBefore: [],
            contextAfter: [],
          },
          "needle",
        )
      }
    >
      Open search match
    </button>
  ),
}));

beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  state.project = { id: "alpha", rootPath: "C:/alpha" };
  state.list.mockReset().mockResolvedValue([]);
  state.read.mockReset().mockResolvedValue("file content");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const file = (name: string) => ({ name, path: `C:/alpha/${name}`, isDirectory: false });

describe("Workspace recovery", () => {
  it("does not call a failed load empty; retry recovers the actual listing", async () => {
    state.list
      .mockRejectedValueOnce("Permission denied")
      .mockResolvedValue([file("recovered.txt")]);
    const ui = render(<WorkspacePanel />);
    await waitFor(() => expect(ui.getByText("Could not load this folder")).toBeTruthy());
    expect(ui.queryByText("This folder is empty")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Retry", exact: true }));
    await waitFor(() => expect(ui.getByText("recovered.txt")).toBeTruthy());
    expect(ui.queryByText("Permission denied")).toBeNull();
    expect(state.list).toHaveBeenNthCalledWith(2, "C:/alpha");
  });

  it("a successful empty listing still has its own honest empty state", async () => {
    const ui = render(<WorkspacePanel />);
    await waitFor(() => expect(ui.getByText("This folder is empty")).toBeTruthy());
    expect(ui.queryByText("Could not load this folder")).toBeNull();
  });

  it("clears the old error when the next project has no folder", async () => {
    state.list.mockRejectedValue("Disconnected drive");
    const ui = render(<WorkspacePanel />);
    await waitFor(() => expect(ui.getByText("Disconnected drive")).toBeTruthy());
    state.project = { id: "beta", rootPath: "" };
    ui.rerender(<WorkspacePanel />);
    await waitFor(() => expect(ui.getByText("No folder open")).toBeTruthy());
    expect(ui.queryByText("Disconnected drive")).toBeNull();
  });

  it("a delayed retry failure cannot overwrite another project's tree", async () => {
    let rejectRetry!: (reason: string) => void;
    state.list.mockRejectedValueOnce("Offline").mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRetry = reject;
        }),
    );
    const ui = render(<WorkspacePanel />);
    await waitFor(() => expect(ui.getByRole("button", { name: "Retry" })).toBeTruthy());
    fireEvent.click(ui.getByRole("button", { name: "Retry" }));
    state.list.mockResolvedValue([file("beta.txt")]);
    state.project = { id: "beta", rootPath: "C:/beta" };
    ui.rerender(<WorkspacePanel />);
    await waitFor(() => expect(ui.getByText("beta.txt")).toBeTruthy());
    await act(async () => rejectRetry("Stale failure"));
    expect(ui.queryByText("Stale failure")).toBeNull();
    expect(ui.getByText("beta.txt")).toBeTruthy();
  });

  it("a search result read failure stays visible in search and never opens an empty editor", async () => {
    state.read.mockRejectedValue("File no longer exists");
    const opened = vi.fn();
    window.addEventListener("editor-open-file", opened);
    try {
      const ui = render(<WorkspacePanel />);
      await waitFor(() => expect(ui.getByText("This folder is empty")).toBeTruthy());
      fireEvent.click(ui.getByRole("button", { name: "Search in files" }));
      fireEvent.click(ui.getByRole("button", { name: "Open search match" }));
      await waitFor(() =>
        expect(ui.getByRole("alert").textContent).toContain("Could not open missing.ts"),
      );
      expect(ui.getByRole("alert").textContent).toContain("File no longer exists");
      expect(opened).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("editor-open-file", opened);
    }
  });

  it("does not open a late search result inside the newly selected project", async () => {
    let finishRead!: (content: string) => void;
    state.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const opened = vi.fn();
    window.addEventListener("editor-open-file", opened);
    try {
      const ui = render(<WorkspacePanel />);
      await waitFor(() => expect(ui.getByText("This folder is empty")).toBeTruthy());
      fireEvent.click(ui.getByRole("button", { name: "Search in files" }));
      fireEvent.click(ui.getByRole("button", { name: "Open search match" }));
      state.project = { id: "beta", rootPath: "C:/beta" };
      ui.rerender(<WorkspacePanel />);
      await waitFor(() => expect(state.list).toHaveBeenCalledWith("C:/beta"));
      await act(async () => finishRead("alpha content"));
      expect(opened).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("editor-open-file", opened);
    }
  });
});
