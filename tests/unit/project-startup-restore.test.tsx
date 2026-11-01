import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalState, TileLayout } from "../../src/terminal/model/types";

const db = vi.hoisted(() => ({ load: vi.fn(), insert: vi.fn(), save: vi.fn(), adopt: vi.fn() }));
vi.mock("@/projects/data/projects-db", () => ({
  loadProjects: db.load,
  readProjectRecovery: () => [],
  insertProject: db.insert,
  saveProject: db.save,
  deleteProject: vi.fn(),
}));
vi.mock("@/calendar/api", () => ({
  adoptUnassignedEvents: db.adopt,
  deleteProjectEvents: vi.fn(),
  deleteProjectScheduledTasks: vi.fn(),
}));
vi.mock("@/common/filesystem/fs-bridge", () => ({ openFolderDialog: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "C:/home" }));
vi.mock("@/git/hooks/use-git-status", () => ({ refreshGit: vi.fn() }));
vi.mock("@/search/hooks/use-global-search", () => ({ setGlobalSearchRootPath: vi.fn() }));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({
  debugLog: vi.fn(),
  startAutoSave: vi.fn(),
}));

const storage = new Map<string, string>();
const projects = [
  { id: "one", name: "One", rootPath: "C:/one", createdAt: 1 },
  { id: "two", name: "Two", rootPath: "C:/two", createdAt: 2 },
];
const grid = (group: string): TileLayout => ({
  columnCount: 2,
  columnRatios: [3, 1],
  cells: [
    { id: `${group}-a`, tabId: `${group}-1`, col: 0, row: 0, colSpan: 1, rowSpan: 1 },
    { id: `${group}-b`, tabId: `${group}-2`, col: 1, row: 0, colSpan: 1, rowSpan: 1 },
  ],
});
const workspace = (): TerminalState => ({
  groups: projects.map((p) => ({ id: p.id, name: p.name, cwd: p.rootPath })),
  activeGroupId: "two",
  activeTabId: "two-2",
  layout: grid("two"),
  savedLayouts: { one: grid("one") },
  tabs: projects.flatMap((p) =>
    [1, 2].map((n) => ({
      id: `${p.id}-${n}`,
      sessionId: `session-${p.id}-${n}`,
      title: `Shell ${n}`,
      groupId: p.id,
      cwd: p.rootPath,
      profile: "code-assistant",
      detached: false,
      status: "running" as const,
    })),
  ),
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  db.load.mockReset().mockResolvedValue(projects);
  db.insert.mockResolvedValue(undefined);
  db.save.mockResolvedValue(undefined);
  db.adopt.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function reopen(saved: TerminalState) {
  const { saveWorkspace } = await import("../../src/terminal/data/workspace-storage");
  saveWorkspace(saved);
  storage.set("active-project-id", saved.activeGroupId);
  const terminals = await import("../../src/terminal/hooks/use-terminal-tabs");
  terminals.startWorkspacePersistence();
  const hook = renderHook(() => terminals.useTerminalTabs());
  const { startProjectSync } = await import("@/app/project-sync");
  const P = await import("@/projects/api");
  await act(async () => {
    startProjectSync();
    await P.whenProjectsReady();
  });
  return { P, hook };
}

it("retries a failed startup read and restores all projects, focus and grids without disabling writes", async () => {
  db.load.mockRejectedValueOnce(new Error("database locked during startup"));
  const saved = workspace();
  const { P, hook } = await reopen(saved);
  expect(P.getProjectsState().projects).toEqual(projects);
  expect(hook.result.current.state).toMatchObject(saved);
  expect(db.load).toHaveBeenCalledTimes(2);
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.adopt).toHaveBeenCalledWith("one");
  act(() => P.createProject("C:/three"));
  expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "C:/three" }));
});

it("creates one shell for a new folder and reuses the project when reopening that folder", async () => {
  const { P, hook } = await reopen(workspace());
  const { openProjectFolder } = await import("@/app/project-actions");
  const navigate = vi.fn();
  window.addEventListener("app-switch-view", navigate);
  try {
    act(() => openProjectFolder("C:/three"));
    const project = P.getActiveProject()!;
    expect(project.rootPath).toBe("C:/three");
    expect(hook.result.current.state.activeGroupId).toBe(project.id);
    expect(hook.result.current.state.tabs.filter((t) => t.groupId === project.id)).toHaveLength(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    act(() => P.switchProject("one"));
    act(() => openProjectFolder("c:\\THREE\\"));
    expect(P.getActiveProject()?.id).toBe(project.id);
    expect(hook.result.current.state.tabs.filter((t) => t.groupId === project.id)).toHaveLength(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("app-switch-view", navigate);
  }
});

it("handles a shared new-project request once and removes the listener on stop", async () => {
  const { P } = await reopen(workspace());
  const { openFolderDialog } = await import("@/common/filesystem/fs-bridge");
  const { startProjectActions } = await import("@/app/project-actions");
  const { requestNewProject } = await import("@/common/events/app-events");
  vi.mocked(openFolderDialog).mockResolvedValueOnce("C:/picked").mockResolvedValueOnce(null);
  const stop = startProjectActions();
  expect(startProjectActions()).toBe(stop);
  try {
    await act(async () => {
      requestNewProject();
    });
    expect(openFolderDialog).toHaveBeenCalledTimes(1);
    expect(P.getActiveProject()?.rootPath).toBe("C:/picked");
    const count = P.getProjectsState().projects.length;
    await act(async () => {
      requestNewProject();
    });
    expect(P.getProjectsState().projects).toHaveLength(count);
    stop();
    requestNewProject();
    expect(openFolderDialog).toHaveBeenCalledTimes(2);
  } finally {
    stop();
  }
});

it("keeps the last workspace's project identities and both grids when SQLite stays unavailable", async () => {
  db.load.mockRejectedValue(new Error("database unavailable"));
  const saved = workspace();
  const { P, hook } = await reopen(saved);
  expect(P.getProjectsState().projects).toEqual(projects.map((p) => ({ ...p, createdAt: 0 })));
  expect(P.getProjectsState().activeId).toBe("two");
  expect(hook.result.current.state).toMatchObject(saved);
  const durable = JSON.parse(storage.get("cairngorm-terminal-workspace-v1")!).state;
  expect(durable.groups).toEqual(saved.groups);
  expect(durable.layout).toMatchObject(saved.layout);
  expect(durable.savedLayouts).toMatchObject(saved.savedLayouts);
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.adopt).not.toHaveBeenCalled();
});

it("recovers a malformed saved directory as empty without breaking folder selection", async () => {
  db.load.mockRejectedValue(new Error("database unavailable"));
  const saved = JSON.parse(JSON.stringify(workspace()));
  saved.groups[0].cwd = 123;
  const { P } = await reopen(saved);
  expect(P.getProjectsState().projects.find((project) => project.id === "one")?.rootPath).toBe("");
  const { openProjectFolder } = await import("@/app/project-actions");
  act(() => openProjectFolder("C:/new"));
  expect(P.getActiveProject()?.rootPath).toBe("C:/new");
});

it("repairs legacy cell origins outside the saved column count without losing panes", async () => {
  const saved = workspace();
  saved.layout!.cells = saved.layout!.cells.map((c) => ({ ...c, col: c.col + 5 }));
  const { hook } = await reopen(saved);
  expect(hook.result.current.state.layout).toMatchObject({ ...grid("two"), columnRatios: [1, 1] });
});

it("preserves columns and rows covered only by stretched panes on reopen and project switch", async () => {
  const saved = workspace();
  const stretched = (group: string): TileLayout => ({
    columnCount: 3,
    columnRatios: [3, 2, 1],
    cells: [
      { id: `${group}-a`, tabId: `${group}-1`, col: 0, row: 0, colSpan: 3, rowSpan: 2 },
      { id: `${group}-b`, tabId: `${group}-2`, col: 0, row: 2, colSpan: 3, rowSpan: 1 },
    ],
  });
  saved.layout = stretched("two");
  saved.savedLayouts.one = stretched("one");
  const { hook } = await reopen(saved);
  expect(hook.result.current.state.layout).toMatchObject(saved.layout);
  expect(hook.result.current.state.savedLayouts).toMatchObject(saved.savedLayouts);
  act(() => hook.result.current.switchGroup("one"));
  expect(hook.result.current.state.layout).toMatchObject(saved.savedLayouts.one);
});
