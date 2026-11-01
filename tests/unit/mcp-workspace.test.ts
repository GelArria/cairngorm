import { cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalState, TermTab } from "@/terminal/types";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { useMcpWorkspace } from "@/app/hooks/use-mcp-workspace";

beforeEach(() => invoke.mockReset());
afterEach(cleanup);
const tab = (id: string, groupId: string, extra: Partial<TermTab> = {}): TermTab => ({
  id,
  groupId,
  sessionId: `session-${id}`,
  title: id,
  profile: "shell",
  status: "running",
  detached: false,
  ...extra,
});
const state = (): TerminalState => ({
  tabs: [
    tab("active", "a"),
    tab("inactive", "b", { detached: true }),
    tab("no-folder", "c"),
    tab("tests", "a", { kind: "tests" }),
    tab("plugin", "b", { kind: "plugin" }),
    tab("dirty", "b", { kind: "file", fullPath: "C:/Other/file.txt", isDirty: true }),
    tab("clean", "a", { kind: "file", fullPath: "C:/Project/clean.txt" }),
  ],
  groups: [
    { id: "a", name: "Active", cwd: "C:/Project" },
    { id: "b", name: "Other", cwd: "C:/Other" },
    { id: "c", name: "No folder" },
  ],
  layout: null,
  activeTabId: "active",
  activeGroupId: "a",
  savedLayouts: {},
});
it("maps only source terminals including inactive and detached sources, never an active-project fallback", async () => {
  const view = renderHook(({ current }) => useMcpWorkspace(current), {
    initialProps: { current: state() },
  });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("plugins_sync_workspace", {
      terminals: [
        { sessionId: "session-active", projectId: "a", rootPath: "C:/Project" },
        { sessionId: "session-inactive", projectId: "b", rootPath: "C:/Other" },
      ],
      dirtyPaths: ["C:/Other/file.txt"],
    }),
  );
  view.rerender({ current: { ...state(), tabs: [] } });
  await waitFor(() =>
    expect(invoke).toHaveBeenLastCalledWith("plugins_sync_workspace", {
      terminals: [],
      dirtyPaths: [],
    }),
  );
});
it("serializes scope removal after an in-flight update", async () => {
  let release!: () => void;
  invoke.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const view = renderHook(({ current }) => useMcpWorkspace(current), {
    initialProps: { current: state() },
  });
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  view.rerender({ current: { ...state(), tabs: [] } });
  expect(invoke).toHaveBeenCalledTimes(1);
  release();
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke).toHaveBeenLastCalledWith("plugins_sync_workspace", {
    terminals: [],
    dirtyPaths: [],
  });
});
