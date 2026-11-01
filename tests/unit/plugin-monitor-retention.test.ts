import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: any }) => void>(),
  tabs: [] as { kind: string; pluginCallId: string }[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: any) => {
    mocks.listeners.set(name, handler);
    return () => mocks.listeners.delete(name);
  },
}));
vi.mock("@/terminal/workspace", () => ({
  getTerminalTabs: () => mocks.tabs,
  useTerminalTabs: () => ({ state: { tabs: mocks.tabs } }),
  openPluginTab: ({ callId }: { callId: string }) => {
    mocks.tabs = [{ kind: "plugin", pluginCallId: callId }];
    return true;
  },
}));
vi.mock("@/plugins/data/plugin-store", () => ({
  publishPluginCall: vi.fn(),
  finishPluginCall: vi.fn(),
  retainPluginCalls: vi.fn(),
}));
import { usePluginMonitor } from "@/plugins/hooks/use-plugin-monitor";

beforeEach(() => {
  mocks.tabs = [];
  mocks.listeners.clear();
  mocks.invoke.mockReset();
});
afterEach(cleanup);

it("releases coalesced intermediate pane calls and serializes native reference updates", async () => {
  let active = 0;
  let maxActive = 0;
  mocks.invoke.mockImplementation(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active--;
  });
  const view = renderHook(usePluginMonitor);
  await waitFor(() => expect(mocks.listeners.has("plugin-call")).toBe(true));
  act(() => {
    for (let i = 0; i < 82; i++) {
      const id = `batched-${i}`;
      mocks.listeners.get("plugin-call")!({
        payload: { id, plugin: "tldraw", pluginName: "tldraw", terminal: "batch-terminal" },
      });
      mocks.listeners.get("plugin-call-result")!({ payload: { id, result: {} } });
    }
  });
  view.rerender();
  const releases = () =>
    mocks.invoke.mock.calls
      .filter(([cmd, args]) => cmd === "plugin_view_event" && args.event === "released")
      .map(([, args]) => args.callId);
  await waitFor(() => expect(releases()).toHaveLength(81));
  expect(new Set(releases())).toEqual(
    new Set(Array.from({ length: 81 }, (_, i) => `batched-${i}`)),
  );
  expect(releases()).not.toContain("batched-81");
  expect(maxActive).toBe(1);
  mocks.tabs = [];
  view.rerender();
  await waitFor(() => expect(releases()).toContain("batched-81"));
});
