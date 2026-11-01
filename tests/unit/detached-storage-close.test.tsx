import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TermTab } from "../../src/terminal/model/types";
const mocks = vi.hoisted(() => ({
  state: { tabs: [] as TermTab[], layout: null },
  invoke: vi.fn(async (_command: string, _args?: unknown) => {}),
  emitTo: vi.fn(async () => {}),
  flush: vi.fn(async () => {}),
  clear: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  hydrate: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emitTo }));
vi.mock("../../src/terminal/data/native-storage", () => ({
  flushStorage: mocks.flush,
  registerStorageCloseCleanup: mocks.register,
}));
vi.mock("../../src/terminal/data/scrollback-store", () => ({ clearScrollback: mocks.clear }));
vi.mock("../../src/terminal/hooks/use-terminal-tabs", () => ({
  useTerminalTabs: () => ({ state: mocks.state, closeTab: vi.fn() }),
  hydrateDetachedGroup: mocks.hydrate,
}));
vi.mock("../../src/terminal/hooks/use-detached-close-events", () => ({
  useDetachedCloseEvents: () => {},
}));
vi.mock("../../src/terminal/components/terminal-tabs", () => ({ TerminalTabs: () => null }));
vi.mock("../../src/common/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: any }) => children,
}));
vi.mock("../../src/common/ui/icon", () => ({ Icon: () => null }));
vi.mock("../../src/common/branding", () => ({ CairngormLoader: () => null }));
import { DetachedTerminalView } from "../../src/terminal/components/terminal-detached-view";
const tab = (id: string): TermTab => ({
  id,
  sessionId: `session-${id}`,
  title: id,
  profile: "shell",
  status: "running",
  detached: false,
});
const group = { id: "first", members: [tab("first")], layout: null };
let close!: () => Promise<void>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = { tabs: [tab("first")], layout: null };
  mocks.register.mockImplementation((callback) => {
    close = callback;
    return mocks.unregister;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("ordinary close uses current members, kills only owned PTYs, clears their histories and removes main metadata", async () => {
  const view = render(<DetachedTerminalView group={group} />);
  await act(async () => {});
  mocks.state = {
    tabs: [
      tab("later"),
      { ...tab("other-window"), detached: true },
      { ...tab("file"), kind: "file" },
    ],
    layout: null,
  };
  view.rerender(<DetachedTerminalView group={group} />);
  await act(async () => {});
  await close();
  expect(mocks.invoke.mock.calls.filter(([command]) => command === "pty_kill")).toEqual([
    ["pty_kill", { sessionId: "session-later" }],
  ]);
  expect(mocks.clear).toHaveBeenCalledExactlyOnceWith("session-later");
  expect(mocks.flush).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledWith("emit_terminal_event", {
    target: "main",
    event: "terminal-detached-state",
    payload: { windowLabel: "detached-first", members: [], layout: null, activeTabId: null },
  });
  expect(mocks.emitTo).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.clear.mock.invocationCallOrder[0],
  );
  expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.invoke.mock.invocationCallOrder.at(-1)!,
  );
  view.unmount();
  expect(mocks.unregister).toHaveBeenCalledOnce();
});
it("reattach flushes before notifying main, and subsequent close cleanup never kills its PTYs", async () => {
  const view = render(<DetachedTerminalView group={group} />);
  await act(async () => {});
  const events: string[] = [];
  const dispatch = window.dispatchEvent.bind(window);
  vi.spyOn(window, "dispatchEvent").mockImplementation((event) => {
    events.push(event.type);
    return dispatch(event);
  });
  let acknowledge!: () => void;
  mocks.flush.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Reattach" }));
  });
  expect(events).toEqual(["terminal-save-scrollback"]);
  await act(async () => {
    acknowledge();
  });
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("emit_terminal_event", {
      target: "main",
      event: "terminal-reattach",
      payload: expect.objectContaining({ windowLabel: "detached-first" }),
    }),
  );
  expect(events).toEqual(["terminal-save-scrollback", "terminal-detach-pty"]);
  expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.invoke.mock.invocationCallOrder[0],
  );
  expect(mocks.emitTo).not.toHaveBeenCalled();
  mocks.invoke.mockClear();
  await close();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
});
