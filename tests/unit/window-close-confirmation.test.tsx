import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TermTab } from "../../src/terminal/model/types";

const mocks = vi.hoisted(() => ({
  tabs: [] as TermTab[],
  destroy: vi.fn(async () => {}),
  onCloseRequested: vi.fn(),
  execute: vi.fn(async () => {}),
  select: vi.fn(async () => []),
}));
vi.mock("../../src/terminal/hooks/use-terminal-tabs", () => ({
  getTerminalTabs: () => mocks.tabs,
}));
vi.mock("../../src/common/storage/db", () => ({ execute: mocks.execute, select: mocks.select }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks }));
let close: (event: { preventDefault(): void }) => Promise<void>;
let guard: typeof import("../../src/terminal/data/close-confirmation");
let store: typeof import("../../src/terminal/data/native-storage");
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.tabs = [
    {
      id: "one",
      title: "Long running shell",
      sessionId: "one",
      profile: "shell",
      status: "running",
      detached: false,
      openedAt: Date.now() - 5 * 60_000,
    },
    {
      id: "two",
      title: "Detached agent",
      sessionId: "two",
      profile: "agent",
      status: "idle",
      detached: true,
      openedAt: Date.now(),
      groupId: "other",
    },
  ];
  guard = await import("../../src/terminal/data/close-confirmation");
  store = await import("../../src/terminal/data/native-storage");
  mocks.onCloseRequested.mockImplementation(async (callback) => {
    close = callback;
    return vi.fn();
  });
  const { TerminalCloseConfirmation } =
    await import("../../src/terminal/components/terminal-close-confirmation");
  render(<TerminalCloseConfirmation />);
  await store.installStorageCloseGuard();
});
afterEach(() => {
  cleanup();
  guard.answerCloseConfirmation(false);
  window.history.replaceState(null, "", "/");
});

it("Cancel/Escape/dialog X keep every session alive; native repeats do not bypass the prompt", async () => {
  const cleanupSessions = vi.fn(async () => {});
  store.registerStorageCloseCleanup(cleanupSessions);
  for (const dismiss of ["Cancel", "Escape", "Close"]) {
    let closing!: Promise<void>;
    const event = { preventDefault: vi.fn() };
    await act(async () => {
      closing = close(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(screen.queryByText("Are you sure?")).toBeNull();
    await act(async () => {
      await close(event);
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    if (dismiss === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.click(screen.getByRole("button", { name: dismiss, exact: true }));
    await closing;
    expect(cleanupSessions).not.toHaveBeenCalled();
    expect(mocks.destroy).not.toHaveBeenCalled();
  }
  let closing!: Promise<void>;
  await act(async () => {
    closing = close({ preventDefault: vi.fn() });
  });
  fireEvent.click(screen.getByRole("button", { name: "Close Cairngorm", exact: true }));
  await closing;
  expect(cleanupSessions).toHaveBeenCalledOnce();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it("a detached window names its scope and stops only that window after approval", async () => {
  window.history.replaceState(null, "", "/?detached=one");
  mocks.tabs = [mocks.tabs[0]];
  let closing!: Promise<void>;
  await act(async () => {
    closing = close({ preventDefault: vi.fn() });
  });
  expect(screen.getByRole("dialog", { name: "Close terminal window?" })).toBeTruthy();
  expect(screen.queryByText("Are you sure?")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close window", exact: true }));
  await closing;
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it("does not prompt when the window only contains file tabs", async () => {
  mocks.tabs = [
    {
      id: "file",
      title: "notes.txt",
      sessionId: "file",
      profile: "file",
      status: "idle",
      detached: false,
      openedAt: Date.now() - 10 * 60_000,
      kind: "file",
      isDirty: true,
    },
  ];
  await close({ preventDefault: vi.fn() });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it("legacy persistence still protects native closure; empty/fresh windows close directly", async () => {
  mocks.select.mockRejectedValueOnce(new Error("SQLite unavailable"));
  await store.initializeStorage("workspace");
  let closing!: Promise<void>;
  await act(async () => {
    closing = close({ preventDefault: vi.fn() });
  });
  expect(screen.getByRole("dialog", { name: "Close Cairngorm?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await closing;
  mocks.tabs = [];
  await close({ preventDefault: vi.fn() });
  expect(mocks.destroy).toHaveBeenCalledOnce();
});
