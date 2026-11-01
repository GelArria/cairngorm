import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TermTab } from "../../src/terminal/model/types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined), clear: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../src/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));
vi.mock("../../src/terminal/data/scrollback-store", () => ({ clearScrollback: mocks.clear }));
let store: typeof import("../../src/terminal/hooks/use-terminal-tabs");
let guard: typeof import("../../src/terminal/data/close-confirmation");
let now = 1_800_000_000_000;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  store = await import("../../src/terminal/hooks/use-terminal-tabs");
  guard = await import("../../src/terminal/data/close-confirmation");
});
afterEach(() => {
  cleanup();
  guard.answerCloseConfirmation(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const open = () => {
  const hook = renderHook(() => store.useTerminalTabs());
  act(() => hook.result.current.openTab());
  return hook;
};
const age = () => {
  now += guard.CLOSE_CONFIRM_AFTER_MS;
};
const answer = async (approved: boolean) => {
  await act(async () => guard.answerCloseConfirmation(approved));
};

it("closes a fresh terminal directly but protects exactly the five-minute boundary", async () => {
  const { result } = open();
  const first = result.current.activeTab!;
  expect(first.openedAt).toBe(now);
  expect(guard.needsCloseConfirmation(first, now + guard.CLOSE_CONFIRM_AFTER_MS - 1)).toBe(false);
  age();
  act(() => result.current.closeTab(first.id));
  expect(result.current.state.tabs).toHaveLength(1);
  expect(mocks.invoke).not.toHaveBeenCalledWith("pty_kill", expect.anything());
  expect(mocks.clear).not.toHaveBeenCalled();
  await answer(false);
  expect(result.current.state.tabs).toHaveLength(1);
  act(() => result.current.closeTab(first.id));
  await answer(true);
  expect(result.current.state.tabs).toHaveLength(0);
  expect(mocks.invoke).toHaveBeenCalledWith("pty_kill", { sessionId: first.sessionId });
  expect(mocks.clear).toHaveBeenCalledWith(first.sessionId);
  act(() => result.current.openTab());
  act(() => result.current.closeTab(result.current.activeTab!.id));
  expect(result.current.state.tabs).toHaveLength(0);
  expect(guard.getCloseConfirmation()).toBeNull();
});

it("keeps the original target through repeated clicks, a new tab, and a project switch", async () => {
  const { result } = open();
  const first = result.current.activeTab!;
  act(() => result.current.openTab());
  const second = result.current.activeTab!;
  age();
  act(() => result.current.closeTab(first.id));
  act(() => result.current.closeTab(second.id));
  act(() => result.current.openTab());
  act(() => result.current.switchGroup("another"));
  expect(guard.getCloseConfirmation()).toMatchObject({ title: "Close terminal?" });
  await answer(true);
  expect(result.current.state.tabs.map((t) => t.id)).toEqual([
    second.id,
    result.current.state.tabs[1].id,
  ]);
  expect(mocks.invoke.mock.calls.filter(([cmd]) => cmd === "pty_kill")).toEqual([
    ["pty_kill", { sessionId: first.sessionId }],
  ]);
});

it("a confirmation cannot kill a restarted replacement session", async () => {
  const { result } = open();
  const first = result.current.activeTab!;
  age();
  act(() => result.current.closeTab(first.id));
  act(() => result.current.restartTab(first.id));
  mocks.invoke.mockClear();
  await answer(true);
  expect(result.current.state.tabs).toHaveLength(1);
  expect(result.current.activeTab?.sessionId).not.toBe(first.sessionId);
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("split children start their own clock and detaching/hydrating/reattaching preserves age", async () => {
  const { result } = open();
  const first = result.current.activeTab!;
  age();
  act(() => result.current.splitTab(first.id, "vertical"));
  const child = result.current.activeTab!;
  expect(child.openedAt).toBe(now);
  expect(guard.needsCloseConfirmation(child)).toBe(false);
  act(() => result.current.detachTab(first.id, "detached-first"));
  expect(store.getTerminalTab(first.id)?.openedAt).toBe(first.openedAt);
  vi.resetModules();
  const detached = await import("../../src/terminal/hooks/use-terminal-tabs");
  await detached.hydrateDetachedGroup([first], null);
  expect(detached.getTerminalTab(first.id)?.openedAt).toBe(first.openedAt);
  const member = { ...child, id: "new-in-detached", sessionId: "new-session" };
  act(() => result.current.closeTab(child.id, true));
  act(() => store.attachGroup([first, member], null));
  expect(store.getTerminalTab(member.id)?.openedAt).toBe(child.openedAt);
});

it("a detached member sends no kill event until approval", async () => {
  const { result } = open();
  const first = result.current.activeTab!;
  age();
  act(() => result.current.detachTab(first.id, "detached-first"));
  mocks.invoke.mockClear();
  act(() => result.current.closeTab(first.id));
  expect(mocks.invoke).not.toHaveBeenCalled();
  await answer(true);
  expect(mocks.invoke).toHaveBeenCalledWith("emit_terminal_event", {
    event: `pty-kill-${first.id}`,
    payload: {},
    target: null,
  });
});

it("closes files without confirmation and protects aged terminals regardless of status", async () => {
  const { result } = open();
  let id = "";
  act(() => {
    id = result.current.openFileTab({
      title: "notes.txt",
      path: ["notes.txt"],
      content: "original",
    });
  });
  act(() => result.current.updateFileContent(id, "unsaved"));
  act(() => result.current.closeTab(id));
  expect(store.getTerminalTab(id)).toBeUndefined();
  expect(guard.getCloseConfirmation()).toBeNull();

  age();
  for (const status of ["idle", "error", "reconnecting"] as TermTab["status"][]) {
    expect(guard.needsCloseConfirmation({ ...result.current.state.tabs[0], status })).toBe(true);
  }
  expect(guard.needsCloseConfirmation({ ...result.current.state.tabs[0], kind: "file" })).toBe(
    false,
  );
  expect(guard.needsCloseConfirmation({ ...result.current.state.tabs[0], kind: "tests" })).toBe(
    false,
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  act(() => store.openTestsTab(result.current.state.tabs[0].sessionId));
  const testTab = result.current.state.tabs.find((t) => t.kind === "tests")!;
  age();
  act(() => result.current.closeTab(testTab.id));
  expect(store.getTerminalTab(testTab.id)).toBeUndefined();
  expect(guard.getCloseConfirmation()).toBeNull();
  let agedFileId = "";
  act(() => {
    agedFileId = result.current.openFileTab({
      title: "old.txt",
      path: ["old.txt"],
      content: "saved",
    });
  });
  age();
  act(() => result.current.closeTab(agedFileId));
  expect(guard.getCloseConfirmation()).toBeNull();
});
