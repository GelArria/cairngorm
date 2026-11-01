import { act, cleanup, renderHook } from "@testing-library/preact";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn(async () => undefined) }));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/testing/data/animate-test-tab", () => ({ animateTestTab: vi.fn() }));
beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => saved.set(k, v),
    removeItem: (k: string) => saved.delete(k),
  });
});
afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllGlobals();
});

it("hiding a Tests pane retains its identity and reopening reuses it", async () => {
  const store = await import("../../src/terminal/hooks/use-terminal-tabs");
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab({ title: "Source" }));
  const source = hook.result.current.activeTab!;
  act(() => store.openTestsTab(source.sessionId));
  const pane = hook.result.current.activeTab!;
  act(() => store.hideTestsTabs());
  expect(hook.result.current.state.tabs.find((t) => t.id === pane.id)).toBeDefined();
  expect(hook.result.current.inlineTabs.some((t) => t.id === pane.id)).toBe(false);
  expect(hook.result.current.activeTab?.id).toBe(source.id);
  act(() => store.openTestsTab(source.sessionId));
  expect(hook.result.current.activeTab?.id).toBe(pane.id);
  expect(hook.result.current.activeTab?.sessionId).toBe(pane.sessionId);
  expect(hook.result.current.state.tabs.filter((t) => t.kind === "tests")).toHaveLength(1);
  act(() => hook.result.current.restartTab(source.id));
  const restarted = hook.result.current.state.tabs.find((tab) => tab.id === source.id)!;
  expect(restarted.sessionId).not.toBe(source.sessionId);
  act(() => store.openTestsTab(restarted.sessionId));
  expect(hook.result.current.activeTab?.id).toBe(pane.id);
  expect(hook.result.current.activeTab?.testSessionId).toBe(restarted.sessionId);
});

it("excludes hidden panes from focus and layouts without undoing later layout edits", async () => {
  const store = await import("../../src/terminal/hooks/use-terminal-tabs");
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab({ title: "Source" }));
  const source = hook.result.current.activeTab!;
  act(() => hook.result.current.splitTab(source.id, "vertical"));
  const second = hook.result.current.activeTab!;
  act(() => store.openTestsTab(source.sessionId));
  const pane = hook.result.current.activeTab!;
  expect(hook.result.current.state.layout?.cells).toHaveLength(3);
  act(() => store.hideTestsTabs());
  expect(hook.result.current.state.layout?.cells.map((cell) => cell.tabId).sort()).toEqual(
    [source.id, second.id].sort(),
  );
  act(() => hook.result.current.setActiveTab(pane.id));
  expect(hook.result.current.activeTab?.id).toBe(source.id);
  act(() => hook.result.current.arrangeSplit("rows"));
  const changedLayout = hook.result.current.state.layout;
  act(() => store.showHiddenTestsTabs());
  expect(hook.result.current.state.layout).toEqual(changedLayout);
  expect(hook.result.current.activeTab?.id).toBe(source.id);
  act(() => store.openTestsTab(source.sessionId));
  expect(hook.result.current.state.layout?.cells.map((cell) => cell.tabId).sort()).toEqual(
    [source.id, second.id, pane.id].sort(),
  );
  expect(hook.result.current.activeTab?.openedAt).toBe(pane.openedAt);
});

it("restores background views without switching projects or stealing focus", async () => {
  const store = await import("../../src/terminal/hooks/use-terminal-tabs");
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab({ title: "Project A" }));
  const source = hook.result.current.activeTab!;
  act(() => store.openTestsTab(source.sessionId));
  const pane = hook.result.current.activeTab!;
  act(() => store.hideTestsTabs());
  act(() =>
    store.syncProjectGroups(
      [
        { id: "g1", name: "A" },
        { id: "g2", name: "B" },
      ],
      "g2",
    ),
  );
  act(() => hook.result.current.openTab({ title: "Project B" }));
  const other = hook.result.current.activeTab!;
  act(() => store.showHiddenTestsTabs());
  expect(hook.result.current.state.activeGroupId).toBe("g2");
  expect(hook.result.current.activeTab?.id).toBe(other.id);
  expect(hook.result.current.inlineTabs.map((tab) => tab.id)).toEqual([other.id]);
  expect(hook.result.current.state.tabs.find((tab) => tab.id === pane.id)?.hidden).toBe(false);
  act(() => hook.result.current.switchGroup("g1"));
  expect(hook.result.current.inlineTabs.map((tab) => tab.id)).toEqual([source.id, pane.id]);
});

it("selects a restored inline view when the previous focus is a detached source", async () => {
  const store = await import("../../src/terminal/hooks/use-terminal-tabs");
  const { setState } = await import("../../src/terminal/state/terminal-store");
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab({ title: "Source" }));
  const source = hook.result.current.activeTab!;
  act(() => store.openTestsTab(source.sessionId));
  const pane = hook.result.current.activeTab!;
  act(() => store.hideTestsTabs());
  act(() =>
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) => (tab.id === source.id ? { ...tab, detached: true } : tab)),
      activeTabId: source.id,
    })),
  );
  expect(hook.result.current.inlineTabs).toEqual([]);
  act(() => store.showHiddenTestsTabs());
  expect(hook.result.current.activeTab?.id).toBe(pane.id);
});

it("removes a hidden view only when its source closes and kills only the source PTY", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  const store = await import("../../src/terminal/hooks/use-terminal-tabs");
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab({ title: "Source" }));
  const source = hook.result.current.activeTab!;
  act(() => store.openTestsTab(source.sessionId));
  act(() => store.hideTestsTabs());
  vi.mocked(invoke).mockClear();
  act(() => hook.result.current.closeTab(source.id));
  expect(hook.result.current.state.tabs).toEqual([]);
  expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "pty_kill")).toEqual([
    ["pty_kill", { sessionId: source.sessionId }],
  ]);
});
