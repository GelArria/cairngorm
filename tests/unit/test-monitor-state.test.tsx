import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TermTab } from "../../src/terminal/model/types";

const events = vi.hoisted(() => new Map<string, Set<(event: { payload: any }) => void>>());
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, fn: (event: { payload: any }) => void) => {
    const set = events.get(name) ?? new Set();
    events.set(name, set);
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }),
}));
vi.mock("../../src/terminal/hooks/use-terminal-tabs", () => ({ openTestsTab: vi.fn() }));
beforeEach(() => {
  cleanup();
  events.clear();
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(cleanup);
const emit = (name: string, payload: any) =>
  act(() => events.get(name)?.forEach((fn) => fn({ payload })));
const id = "same-session";
const tab: TermTab = {
  id: "tab",
  title: "Shell",
  profile: "shell",
  status: "running",
  sessionId: id,
  detached: false,
};
const frame = {
  type: "frame",
  pageId: "page",
  timestamp: 1,
  image: "/9j/AA==",
  width: 800,
  height: 600,
};
const run = (passed: number, status = "passed") => ({
  id: 1,
  sessionId: id,
  runner: "Vitest",
  startedAt: 1,
  status,
  passed,
  failed: 0,
  skipped: 0,
  results: [],
  output: [],
});
async function mount(defer = false) {
  const { invoke } = await import("@tauri-apps/api/core");
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation((cmd) =>
    cmd === "pty_test_run" && defer
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(),
  );
  const { useTestMonitor } = await import("../../src/testing/hooks/use-test-monitor");
  const { useTestRun } = await import("../../src/testing/hooks/use-test-run");
  const { useBrowserStreams } = await import("../../src/testing/hooks/use-browser-streams");
  const { useBrowserActivities } = await import("../../src/testing/hooks/use-browser-activities");
  const hook = renderHook(() => {
    useTestMonitor([tab]);
    return {
      run: useTestRun(id),
      streams: useBrowserStreams(id),
      activities: useBrowserActivities(id),
    };
  });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("pty_test_run", { sessionId: id }));
  return { hook, restore: (value: unknown) => act(async () => resolve(value)) };
}

it("accepts a shorter run from a recreated PTY and rejects late updates from its old generation", async () => {
  const { hook } = await mount();
  emit(`pty-test-${id}`, { generation: 1, revision: 50, started: true, run: run(20) });
  await waitFor(() => expect(hook.result.current.run?.passed).toBe(20));
  emit(`pty-exit-${id}`, {});
  emit(`pty-test-${id}`, { generation: 2, revision: 3, started: true, run: run(1) });
  await waitFor(() => expect(hook.result.current.run?.passed).toBe(1));
  emit(`pty-test-${id}`, { generation: 1, revision: 51, started: false, run: run(20) });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(hook.result.current.run?.passed).toBe(1);
});

it("a deferred old PTY snapshot cannot replace a new visual run or prevent page-close completion", async () => {
  const { hook, restore } = await mount(true);
  emit(`test-browser-${id}`, frame);
  await restore({ generation: 1, revision: 50, started: false, run: run(20) });
  await waitFor(() =>
    expect(hook.result.current.run).toMatchObject({
      runner: "Playwright",
      status: "running",
      passed: 0,
    }),
  );
  emit(`test-browser-${id}`, { type: "closed", pageId: "page", timestamp: 2 });
  await waitFor(() => expect(hook.result.current.run?.status).toBe("completed"));
  expect(hook.result.current.streams).toHaveLength(1);
});

it("a deferred old PTY snapshot cannot replace an independent live agent tool", async () => {
  const { hook, restore } = await mount(true);
  const base = { session_id: id, toolCallId: "tool", toolName: "bash" };
  emit("agent-event", {
    ...base,
    type: "tool_execution_start",
    args: { command: "npx vitest run" },
  });
  emit("agent-event", {
    ...base,
    type: "tool_execution_update",
    partialResult: {
      content: [{ type: "text", text: " RUN v4.0.0 /repo\n ✓ live.test.ts > passes\n" }],
    },
  });
  await restore({ generation: 1, revision: 50, started: false, run: run(20) });
  await waitFor(() =>
    expect(hook.result.current.run).toMatchObject({ status: "running", passed: 1 }),
  );
  emit("agent-event", {
    ...base,
    type: "tool_execution_end",
    result: {
      content: [
        {
          type: "text",
          text: " RUN v4.0.0 /repo\n ✓ live.test.ts > passes\n Tests 1 passed (1)\n",
        },
      ],
      details: { exitCode: 0 },
    },
    isError: false,
  });
  await waitFor(() =>
    expect(hook.result.current.run).toMatchObject({ status: "passed", passed: 1 }),
  );
});

it("retains a fast closed page when its own delayed Playwright header finally arrives", async () => {
  const { hook } = await mount();
  emit(`test-browser-${id}`, frame);
  emit(`test-browser-${id}`, { type: "closed", pageId: "page", timestamp: 2 });
  await waitFor(() => expect(hook.result.current.run?.status).toBe("completed"));
  const visual = hook.result.current.run!;
  emit(`pty-test-${id}`, {
    generation: 1,
    revision: 3,
    started: true,
    run: { ...run(1), runner: "Playwright", startedAt: visual.startedAt, endedAt: visual.endedAt },
  });
  await waitFor(() =>
    expect(hook.result.current.run).toMatchObject({ status: "passed", passed: 1 }),
  );
  expect(hook.result.current.streams).toHaveLength(1);
  expect(hook.result.current.streams[0].type).toBe("closed");
});

it.each(["page-close", "pty-exit"])(
  "removes completed visual state before an unrelated nonvisual run (%s)",
  async (ending) => {
    const { hook } = await mount();
    emit(`test-browser-${id}`, frame);
    emit(`test-browser-${id}`, {
      type: "activity",
      pageId: "page",
      activityId: "click",
      label: "Click",
      status: "completed",
      startedAt: 1,
      timestamp: 2,
    });
    if (ending === "page-close")
      emit(`test-browser-${id}`, { type: "closed", pageId: "page", timestamp: 3 });
    else emit(`pty-exit-${id}`, {});
    await waitFor(() =>
      expect(hook.result.current.run?.status).toBe(
        ending === "page-close" ? "completed" : "interrupted",
      ),
    );
    expect(hook.result.current.streams).toHaveLength(1);
    expect(hook.result.current.activities).toHaveLength(1);
    emit(`pty-test-${id}`, { generation: 2, revision: 3, started: true, run: run(1) });
    await waitFor(() => expect(hook.result.current.run?.passed).toBe(1));
    expect(hook.result.current.streams).toEqual([]);
    expect(hook.result.current.activities).toEqual([]);
  },
);
