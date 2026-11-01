import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const events = vi.hoisted(() => new Map<string, () => void>());
const windowMock = vi.hoisted(() => ({ close: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/config", () => ({ getConfig: () => config.value }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: () => void) => {
    events.set(name, handler);
    return () => {};
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowMock }));

function busy(count: number) {
  invoke.mockImplementation(async (command: string) =>
    command === "pty_busy_count" ? count : undefined,
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  events.clear();
  config.value = {};
});

it("closes normally when every terminal is an idle shell", async () => {
  busy(0);
  const { enterBackgroundOnClose } = await import("../../src/app/background");
  expect(await enterBackgroundOnClose()).toBe(false);
  expect(invoke).not.toHaveBeenCalledWith("app_background_enter");
});

it("hides the app while a terminal runs, then lets panes dock again", async () => {
  busy(2);
  const { enterBackgroundOnClose } = await import("../../src/app/background");
  expect(await enterBackgroundOnClose()).toBe(true);
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "pty_busy_count",
    "app_background_enter",
    "app_window_cancel_close",
  ]);
});

it("respects app.keepRunning: false without inspecting terminals", async () => {
  config.value = { app: { keepRunning: false } };
  busy(3);
  const { enterBackgroundOnClose } = await import("../../src/app/background");
  expect(await enterBackgroundOnClose()).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});

it("closes normally when the app cannot be hidden", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "pty_busy_count") return 1;
    throw new Error("no tray");
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { enterBackgroundOnClose } = await import("../../src/app/background");
  expect(await enterBackgroundOnClose()).toBe(false);
});

it("a tray quit closes main for real once, then the setting applies again", async () => {
  busy(1);
  const { enterBackgroundOnClose, listenForBackgroundQuit } =
    await import("../../src/app/background");
  await listenForBackgroundQuit();
  events.get("app-quit-requested")!();
  expect(invoke).toHaveBeenCalledWith("app_background_quit_started");
  expect(windowMock.close).toHaveBeenCalledOnce();
  invoke.mockClear();
  expect(await enterBackgroundOnClose()).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  expect(await enterBackgroundOnClose()).toBe(true);
});

it("a tray quit whose close never ran does not affect a later close", async () => {
  busy(1);
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  const { enterBackgroundOnClose, listenForBackgroundQuit } =
    await import("../../src/app/background");
  await listenForBackgroundQuit();
  events.get("app-quit-requested")!();
  now.mockReturnValue(60_000);
  expect(await enterBackgroundOnClose()).toBe(true);
});
