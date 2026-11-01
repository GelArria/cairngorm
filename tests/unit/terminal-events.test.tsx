import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => ({
    apiKeyEnv: "TEST_KEY",
    apiKey: "secret-sentinel",
    baseUrl: null,
    model: null,
  })),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/terminal/data/scrollback-store", () => ({ clearScrollback: vi.fn() }));
let store: typeof import("../../src/terminal/hooks/use-terminal-tabs");
const originalURL = window.location.href;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/?detached=1");
  store = await import("../../src/terminal/hooks/use-terminal-tabs");
  await store.hydrateDetachedGroup(
    [{ id: "1", sessionId: "session-1", title: "Agent", isAgent: true }],
    null,
  );
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", originalURL);
});
it("publishes detached membership through main-thread IPC without broadcasting credentials", () => {
  expect(mocks.invoke).toHaveBeenCalledWith(
    "emit_terminal_event",
    expect.objectContaining({
      event: "terminal-detached-state",
      target: null,
      payload: expect.objectContaining({
        windowLabel: "detached-1",
        members: [expect.objectContaining({ id: "1", sessionId: "session-1" })],
      }),
    }),
  );
  const delivery = mocks.invoke.mock.calls.find(([command]) => command === "emit_terminal_event");
  expect(JSON.stringify(delivery?.[1])).not.toContain("secret-sentinel");
  expect(mocks.emit).not.toHaveBeenCalled();
});
it("main's close-tab action uses the same safe delivery for its detached kill notification", () => {
  const { result } = renderHook(() => store.useTerminalTabs());
  act(() => result.current.detachTab("1", "detached-1"));
  mocks.invoke.mockClear();
  act(() => result.current.closeTab("1"));
  expect(mocks.invoke).toHaveBeenCalledWith("emit_terminal_event", {
    event: "pty-kill-1",
    payload: {},
    target: null,
  });
  expect(mocks.emit).not.toHaveBeenCalled();
});
