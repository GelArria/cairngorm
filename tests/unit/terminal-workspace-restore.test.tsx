import { act, cleanup, renderHook } from "@testing-library/preact";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => undefined) }));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));

const saved = new Map<string, string>();
beforeEach(() => {
  cleanup();
  saved.clear();
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => saved.set(k, v),
    removeItem: (k: string) => saved.delete(k),
  });
});

it("reopening restores terminal identities, cwd, focus and every project's exact grid without secrets", async () => {
  let store = await import("../../src/terminal/hooks/use-terminal-tabs");
  store.startWorkspacePersistence();
  store.syncProjectGroups(
    [
      { id: "p1", name: "One", cwd: "C:/one" },
      { id: "p2", name: "Two", cwd: "C:/two" },
    ],
    "p1",
  );
  const first = renderHook(() => store.useTerminalTabs());
  act(() =>
    first.result.current.openTab({
      profile: "code-assistant",
      title: "Pi",
      shellPath: "pwsh.exe",
      shellArgs: [],
      shellEnv: {
        API_KEY: "never-save-this",
      },
    }),
  );
  act(() => first.result.current.splitTab(first.result.current.state.activeTabId!, "vertical"));
  act(() => first.result.current.resizeColumns(0, 80, 1000));
  act(() => first.result.current.splitTab(first.result.current.state.activeTabId!, "horizontal"));
  act(() => first.result.current.resizeRows(0, 100, 800));
  expect(first.result.current.state.layout?.rowRatios).toEqual([1.25, 0.75]);
  act(() => first.result.current.switchGroup("p2"));
  act(() => first.result.current.openTab({ profile: "code-assistant", title: "Droid" }));
  const previous = first.result.current.state;
  first.unmount();
  vi.resetModules();
  store = await import("../../src/terminal/hooks/use-terminal-tabs");
  store.startWorkspacePersistence();
  const restored = renderHook(() => store.useTerminalTabs()).result.current.state;
  expect(
    restored.tabs.map(({ id, sessionId, cwd, title }) => ({ id, sessionId, cwd, title })),
  ).toEqual(previous.tabs.map(({ id, sessionId, cwd, title }) => ({ id, sessionId, cwd, title })));
  expect(restored.savedLayouts).toEqual(previous.savedLayouts);
  expect(restored.activeTabId).toBe(previous.activeTabId);
  expect(restored.activeGroupId).toBe("p2");
  expect([...saved.values()].join("")).not.toContain("never-save-this");
  const before = new Set(restored.tabs.map((t) => t.id));
  const newHook = renderHook(() => store.useTerminalTabs());
  act(() => newHook.result.current.openTab());
  expect(store.getTerminalTab()?.id).not.toSatisfy((id: string) => before.has(id));
});

it("restores detached splits reported to main, without letting detached windows replace main's snapshot", async () => {
  let store = await import("../../src/terminal/hooks/use-terminal-tabs");
  store.startWorkspacePersistence();
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab());
  const parent = hook.result.current.activeTab!;
  act(() => hook.result.current.detachTab(parent.id, "detached-qa"));
  const child = { ...parent, id: "new-detached-child", sessionId: "term-child", title: "Child" };
  act(() => store.syncDetachedWorkspace("detached-qa", [parent, child]));
  expect(hook.result.current.state.tabs).toHaveLength(2);
  hook.unmount();
  vi.resetModules();
  store = await import("../../src/terminal/hooks/use-terminal-tabs");
  store.startWorkspacePersistence();
  const reopened = renderHook(() => store.useTerminalTabs());
  expect(reopened.result.current.inlineTabs.map((t) => t.sessionId)).toEqual([
    parent.sessionId,
    child.sessionId,
  ]);
  expect(reopened.result.current.detachedTabs).toHaveLength(0);
});

it("recovers an entire detached grid with its last ratios, focus and working directories", async () => {
  let store = await import("../../src/terminal/hooks/use-terminal-tabs");
  store.startWorkspacePersistence();
  const hook = renderHook(() => store.useTerminalTabs());
  act(() =>
    hook.result.current.openTab({
      profile: "code-assistant",
      title: "First",
      shellPath: "powershell.exe",
      shellArgs: [],
      isAgent: false,
      cwd: "C:/project",
    }),
  );
  act(() => hook.result.current.splitTab(hook.result.current.state.activeTabId!, "vertical"));
  act(() => hook.result.current.resizeColumns(0, 90, 1000));
  const grid = hook.result.current.state;
  for (const tab of grid.tabs) act(() => hook.result.current.detachTab(tab.id, "detached-grid"));
  act(() => store.syncDetachedWorkspace("detached-grid", grid.tabs, grid.layout, grid.activeTabId));
  expect(hook.result.current.state.layout).toBeNull();
  hook.unmount();
  vi.resetModules();
  store = await import("../../src/terminal/hooks/use-terminal-tabs");
  store.startWorkspacePersistence();
  const restored = renderHook(() => store.useTerminalTabs()).result.current;
  expect(restored.state.layout).toEqual(grid.layout);
  expect(restored.state.activeTabId).toBe(grid.activeTabId);
  expect(restored.inlineTabs.map((t) => t.cwd)).toEqual(["C:/project", "C:/project"]);
});

it("saving a dissolved inactive grid does not resurrect the old split on project switch", async () => {
  const store = await import("../../src/terminal/hooks/use-terminal-tabs");
  store.syncProjectGroups(
    [
      { id: "one", name: "One" },
      { id: "two", name: "Two" },
    ],
    "one",
  );
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab());
  act(() => hook.result.current.splitTab(hook.result.current.state.activeTabId!, "vertical"));
  act(() => hook.result.current.switchGroup("two"));
  act(() => hook.result.current.switchGroup("one"));
  act(() => hook.result.current.dissolveSplit());
  act(() => hook.result.current.switchGroup("two"));
  act(() => hook.result.current.switchGroup("one"));
  expect(hook.result.current.state.layout).toBeNull();
});
