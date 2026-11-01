import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestTracker } from "../../src/testing/model/test-tracker";
import { TerminalLines } from "../../src/testing/model/terminal-lines";
const parsers = new Map<string, TerminalLines>();

const events = vi.hoisted(() => new Map<string, Set<(event: { payload: any }) => void>>());
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => undefined),
  listen: vi.fn(async (name: string, fn: (event: { payload: any }) => void) => {
    const set = events.get(name) ?? new Set();
    events.set(name, set);
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) events.delete(name);
    };
  }),
}));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));

beforeEach(() => {
  cleanup();
  events.clear();
  parsers.clear();
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const emit = (name: string, payload: any) =>
  act(() => events.get(name)?.forEach((fn) => fn({ payload })));
// Hook tests exercise the structured wire contract; native parser parity is tested separately.
const output = (id: string, text: string) => {
  if (!parsers.has(id)) {
    let revision = 0;
    const tracker = new TestTracker(id, (run, started) =>
      emit(`pty-test-${id}`, { run, started, generation: 1, revision: ++revision }),
    );
    parsers.set(id, new TerminalLines((line, redraw) => tracker.line(line, redraw)));
  }
  parsers.get(id)!.text(text);
};

async function mount() {
  const tabs = await import("../../src/terminal/hooks/use-terminal-tabs");
  const { useTestMonitor } = await import("../../src/testing/hooks/use-test-monitor");
  const hook = renderHook(() => {
    const state = tabs.useTerminalTabs();
    useTestMonitor(state.state.tabs);
    return state;
  });
  act(() => hook.result.current.openTab({ profile: "code-assistant", title: "pi" }));
  const source = hook.result.current.activeTab!;
  await waitFor(() => expect(events.has(`pty-test-${source.sessionId}`)).toBe(true));
  return { hook, source, tabs };
}

it("keeps browser frames and final native counts when the coalesced header arrives after a frame", async () => {
  const { source } = await mount();
  const { useBrowserStreams } = await import("../../src/testing/hooks/use-browser-streams");
  const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
  const streams = renderHook(() => useBrowserStreams(source.sessionId));
  emit(`test-browser-${source.sessionId}`, {
    type: "frame",
    pageId: "page",
    timestamp: 1,
    image: "/9j/AA==",
    width: 800,
    height: 600,
  });
  output(source.sessionId, "Running 1 test using 1 worker\n1 passed\n");
  await waitFor(() => expect(streams.result.current).toHaveLength(1));
  emit(`pty-exit-${source.sessionId}`, {});
  const run = renderHook(() => useTestRun(source.sessionId));
  await waitFor(() => expect(run.result.current).toMatchObject({ status: "passed", passed: 1 }));
});

it("does not overwrite a live native update with a late restoration snapshot", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  let resolve!: (value: any) => void;
  vi.mocked(invoke).mockImplementation((cmd) =>
    cmd === "pty_test_run"
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(),
  );
  try {
    const { source } = await mount();
    const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
    const run = renderHook(() => useTestRun(source.sessionId));
    const base = {
      id: 1,
      sessionId: source.sessionId,
      runner: "Vitest",
      startedAt: 1,
      failed: 0,
      skipped: 0,
      results: [],
      output: [],
    };
    emit(`pty-test-${source.sessionId}`, {
      generation: 1,
      revision: 2,
      started: true,
      run: { ...base, status: "passed", passed: 2 },
    });
    await act(async () =>
      resolve({
        generation: 1,
        revision: 1,
        started: false,
        run: { ...base, status: "running", passed: 0 },
      }),
    );
    await waitFor(() => expect(run.result.current).toMatchObject({ status: "passed", passed: 2 }));
    expect(events.has(`pty-data-${source.sessionId}`)).toBe(false);
  } finally {
    vi.mocked(invoke).mockResolvedValue(undefined);
  }
});

it("opens once, reuses the testing pane, and never creates a PTY for it", async () => {
  const { hook, source } = await mount();
  output(source.sessionId, " RUN v4.0.0 /repo\n");
  await waitFor(() => expect(hook.result.current.activeTab?.kind).toBe("tests"));
  const first = hook.result.current.activeTab!;
  output(source.sessionId, "Tests 2 passed (2)\n RUN v4.0.0 /repo\n");
  expect(hook.result.current.activeTab?.id).toBe(first.id);
  expect(hook.result.current.state.tabs).toHaveLength(2);
  expect(events.has(`pty-test-${first.sessionId}`)).toBe(false);
  act(() => hook.result.current.closeTab(first.id));
  const { invoke } = await import("@tauri-apps/api/core");
  expect(invoke).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  output(source.sessionId, " ✓ case still running\n");
  expect(hook.result.current.state.tabs).toHaveLength(1);
});

it("observes a background project without stealing focus or leaving orphan panes", async () => {
  const { hook, source, tabs } = await mount();
  act(() =>
    tabs.syncProjectGroups(
      [
        { id: "g1", name: "A" },
        { id: "g2", name: "B" },
      ],
      "g2",
    ),
  );
  output(source.sessionId, "Running 2 tests using 1 worker\n");
  expect(hook.result.current.state.activeGroupId).toBe("g2");
  expect(hook.result.current.state.activeTabId).toBeNull();
  expect(hook.result.current.state.tabs.find((t) => t.kind === "tests")?.groupId).toBe("g1");
  act(() => hook.result.current.closeTab(source.id));
  expect(hook.result.current.state.tabs).toHaveLength(0);
  await waitFor(() => expect(events.has(`pty-test-${source.sessionId}`)).toBe(false));
});

it("does not persist live testing panes or spawn them during workspace restoration", async () => {
  const { hook, source, tabs } = await mount();
  act(() => tabs.startWorkspacePersistence());
  output(source.sessionId, " RUN v4.0.0 /repo\n");
  const { WORKSPACE_KEY } = await import("../../src/terminal/data/workspace-storage");
  const saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY)!);
  expect(saved.state.tabs.map((t: any) => t.kind)).not.toContain("tests");
  expect(saved.state.activeTabId).toBe(source.id);
  hook.unmount();
  await waitFor(() => expect(events.size).toBe(0));
});

it("keeps hidden observers updating and clears their memory only after source removal", async () => {
  const { hook, source, tabs } = await mount();
  const { getTestRun } = await import("../../src/testing/data/test-store");
  const { getBrowserStreams } = await import("../../src/testing/data/browser-store");
  const { testPaneMemory } = await import("../../src/testing/data/test-pane-state");
  output(source.sessionId, "Running 2 tests using 1 worker\n");
  const pane = hook.result.current.activeTab!;
  const memory = testPaneMemory(source.sessionId, getTestRun(source.sessionId)?.id);
  memory.query = "retained query";
  const { setTestAutoOpen } = await import("../../src/testing/data/test-auto-open");
  act(() => {
    setTestAutoOpen(false);
    tabs.hideTestsTabs();
  });
  output(source.sessionId, " ✓ 1 first example (1s)\n");
  emit(`test-browser-${source.sessionId}`, {
    type: "frame",
    pageId: "hidden-page",
    timestamp: 1,
    image: "YWJj",
    width: 640,
    height: 480,
  });
  expect(getTestRun(source.sessionId)?.passed).toBe(1);
  expect(getBrowserStreams(source.sessionId)).toHaveLength(1);
  expect(hook.result.current.state.tabs.find((tab) => tab.id === pane.id)?.hidden).toBe(true);
  expect(hook.result.current.activeTab?.id).toBe(source.id);
  expect(testPaneMemory(source.sessionId, getTestRun(source.sessionId)?.id)).toBe(memory);
  act(() => hook.result.current.closeTab(source.id));
  await waitFor(() => expect(events.has(`pty-test-${source.sessionId}`)).toBe(false));
  expect(getTestRun(source.sessionId)).toBeUndefined();
  expect(getBrowserStreams(source.sessionId)).toEqual([]);
  expect(testPaneMemory(source.sessionId).query).toBe("");
});

it("honors a native shell exit code even when the tool event has isError=false", async () => {
  const { hook, source } = await mount();
  const base = { session_id: source.sessionId, toolCallId: "test", toolName: "bash" };
  emit("agent-event", { ...base, type: "tool_execution_start", args: { command: "npm test" } });
  emit("agent-event", {
    ...base,
    type: "tool_execution_end",
    result: { content: [{ type: "text", text: "configuration error" }], details: { exitCode: 1 } },
    isError: false,
  });
  const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
  const run = renderHook(() => useTestRun(source.sessionId));
  await waitFor(() => expect(run.result.current?.status).toBe("failed"));
  expect(hook.result.current.state.tabs).toHaveLength(2);
});

it("aggregates concurrent native test tools and retains both outcomes", async () => {
  const { hook, source } = await mount();
  const base = { session_id: source.sessionId, toolName: "bash" };
  emit("agent-event", {
    ...base,
    toolCallId: "A",
    type: "tool_execution_start",
    args: { command: "npx vitest run" },
  });
  emit("agent-event", {
    ...base,
    toolCallId: "B",
    type: "tool_execution_start",
    args: { command: "cargo test" },
  });
  const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
  const run = renderHook(() => useTestRun(source.sessionId));
  emit("agent-event", {
    ...base,
    toolCallId: "A",
    type: "tool_execution_end",
    result: { content: [{ type: "text", text: " RUN v4.0.0 /repo\n Tests 2 passed (2)\n" }] },
    isError: false,
  });
  await waitFor(() => expect(run.result.current).toMatchObject({ status: "running", passed: 2 }));
  emit("agent-event", {
    ...base,
    toolCallId: "B",
    type: "tool_execution_end",
    result: {
      content: [
        {
          type: "text",
          text: "running 1 test\ntest broken ... FAILED\ntest result: FAILED. 0 passed; 1 failed;\n",
        },
      ],
    },
    isError: true,
  });
  await waitFor(() =>
    expect(run.result.current).toMatchObject({
      runner: "Concurrent tests",
      status: "failed",
      passed: 2,
      failed: 1,
      total: 3,
    }),
  );
  expect(hook.result.current.state.tabs).toHaveLength(2);
});

it("opens a visual test from a real browser frame and cleans up with the terminal", async () => {
  const { hook, source } = await mount();
  const { useBrowserStreams } = await import("../../src/testing/hooks/use-browser-streams");
  const streams = renderHook(() => useBrowserStreams(source.sessionId));
  emit(`test-browser-${source.sessionId}`, {
    type: "frame",
    pageId: "page",
    timestamp: 1,
    image: "/9j/AA==",
    width: 800,
    height: 600,
    url: "http://localhost:3000",
  });
  await waitFor(() => expect(hook.result.current.activeTab?.kind).toBe("tests"));
  expect(streams.result.current).toHaveLength(1);
  emit(`pty-exit-${source.sessionId}`, {});
  expect(streams.result.current[0].type).toBe("closed");
  act(() => hook.result.current.closeTab(source.id));
  await waitFor(() => expect(streams.result.current).toHaveLength(0));
});

it("finishes a visual-only Playwright script when all its pages close", async () => {
  const { source } = await mount();
  const event = `test-browser-${source.sessionId}`;
  emit(event, {
    type: "frame",
    pageId: "page",
    timestamp: 1,
    image: "/9j/AA==",
    width: 800,
    height: 600,
  });
  emit(event, { type: "closed", pageId: "page", timestamp: 2 });
  const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
  const run = renderHook(() => useTestRun(source.sessionId));
  await waitFor(() => expect(run.result.current?.status).toBe("completed"));
  emit(event, {
    type: "frame",
    pageId: "next",
    timestamp: 3,
    image: "/9j/AA==",
    width: 800,
    height: 600,
  });
  await waitFor(() => expect(run.result.current?.status).toBe("running"));
});

it("does not replace native test results when browser frames arrive", async () => {
  const { source } = await mount();
  const base = { session_id: source.sessionId, toolCallId: "test", toolName: "bash" };
  emit("agent-event", {
    ...base,
    type: "tool_execution_start",
    args: { command: "npx playwright test" },
  });
  emit("agent-event", {
    ...base,
    type: "tool_execution_update",
    partialResult: {
      content: [{ type: "text", text: "Running 3 tests using 1 worker\n ✓ 1 signs in (1s)\n" }],
    },
  });
  emit(`test-browser-${source.sessionId}`, {
    type: "frame",
    pageId: "page",
    timestamp: 1,
    image: "/9j/AA==",
    width: 800,
    height: 600,
  });
  const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
  const run = renderHook(() => useTestRun(source.sessionId));
  await waitFor(() => expect(run.result.current).toMatchObject({ passed: 1, total: 3 }));
});

it("respects a manually closed Tests tab when the first browser screen arrives later", async () => {
  const { hook, source } = await mount();
  output(source.sessionId, "Running 1 test using 1 worker\n");
  act(() => hook.result.current.closeTab(hook.result.current.activeTab!.id));
  emit(`test-browser-${source.sessionId}`, {
    type: "frame",
    pageId: "page",
    timestamp: 1,
    image: "/9j/AA==",
    width: 800,
    height: 600,
  });
  expect(hook.result.current.state.tabs).toHaveLength(1);
});

it("starts a fresh visual execution after a completed nonvisual test", async () => {
  const { hook, source } = await mount();
  output(source.sessionId, " RUN v4.0.0 /repo\n Tests 1 passed (1)\n");
  act(() => hook.result.current.closeTab(hook.result.current.activeTab!.id));
  emit(`test-browser-${source.sessionId}`, {
    type: "frame",
    pageId: "new-page",
    timestamp: 1,
    image: "/9j/AA==",
    width: 800,
    height: 600,
  });
  expect(hook.result.current.activeTab?.kind).toBe("tests");
  const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
  const run = renderHook(() => useTestRun(source.sessionId));
  expect(run.result.current).toMatchObject({ runner: "Playwright", status: "running", passed: 0 });
  emit(`test-browser-${source.sessionId}`, { type: "closed", pageId: "new-page", timestamp: 2 });
  await waitFor(() => expect(run.result.current?.status).toBe("completed"));
});
