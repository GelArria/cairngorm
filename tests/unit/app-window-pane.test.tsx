import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "preact/hooks";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
const windowEvents = vi.hoisted(() => ({
  callbacks: new Map<string, () => void>(),
  stop: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () =>
    Object.fromEntries(
      ["onMoved", "onResized", "onScaleChanged"].map((name) => [
        name,
        async (callback: () => void) => {
          windowEvents.callbacks.set(name, callback);
          return windowEvents.stop;
        },
      ]),
    ),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
import { AppWindowPane } from "@/plugins/app-window-pane";

function Pane() {
  const [hwnd, setHwnd] = useState("101");
  return (
    <AppWindowPane
      hwnd={hwnd}
      appId="excel"
      appName="Microsoft Excel"
      sourceTitle="Code"
      onShowTerminal={() => {}}
      onReopened={setHwnd}
    />
  );
}
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const tick = (time: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(time);
  });
const calls = (command: string) => native.invoke.mock.calls.filter(([name]) => name === command);

beforeEach(() => {
  vi.useFakeTimers();
  native.invoke.mockReset().mockResolvedValue(true);
  windowEvents.callbacks.clear();
  windowEvents.stop.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("detects closure even without resizing and reopens the application", async () => {
  render(<Pane />);
  await flush();
  expect(calls("app_window_dock")).toHaveLength(1);
  native.invoke.mockImplementation(async (command: string) =>
    command === "app_window_open" ? { hwnd: "202" } : false,
  );
  await tick(1000);
  expect(screen.getByRole("status").textContent).toBe("Microsoft Excel was closed.");
  const count = calls("app_window_dock").length;
  await tick(3000);
  expect(calls("app_window_dock")).toHaveLength(count);
  native.invoke.mockImplementation(async (command: string) =>
    command === "app_window_open" ? { hwnd: "202" } : true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reopen Microsoft Excel" }));
  await flush();
  expect(native.invoke).toHaveBeenCalledWith("app_window_open", { appId: "excel" });
  await flush();
  expect(calls("app_window_dock").at(-1)?.[1]).toMatchObject({ hwnd: "202" });
  expect(screen.queryByRole("status")).toBeNull();
});

it("surfaces a welcome-dialog hint and permits retry after reopening fails", async () => {
  native.invoke.mockResolvedValue(false);
  render(<Pane />);
  await flush();
  native.invoke.mockRejectedValue(
    new Error("Close any welcome or sign-in dialog, then try again."),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reopen Microsoft Excel" }));
  await flush();
  expect(screen.getByRole("alert").textContent).toContain("welcome or sign-in dialog");
  expect(
    screen.getByRole("button", { name: "Reopen Microsoft Excel" }).hasAttribute("disabled"),
  ).toBe(false);
});

it("bounds idle checks to one per second but refreshes coordinates after moving or scaling", async () => {
  render(<Pane />);
  await flush();
  await tick(750);
  expect(calls("app_window_dock")).toHaveLength(1);
  await tick(250);
  expect(calls("app_window_dock")).toHaveLength(2);
  await act(async () => {
    windowEvents.callbacks.get("onMoved")!();
  });
  await flush();
  await act(async () => {
    windowEvents.callbacks.get("onScaleChanged")!();
  });
  await flush();
  expect(calls("app_window_dock")).toHaveLength(4);
});

it("waits for an outstanding dock before cleanup and keeps releases scoped to its lease", async () => {
  let finish!: (value: boolean) => void;
  native.invoke.mockImplementation((command: string) =>
    command === "app_window_dock"
      ? new Promise<boolean>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(),
  );
  const view = render(<Pane />);
  await flush();
  const args = calls("app_window_dock")[0][1];
  await tick(3000);
  expect(calls("app_window_dock")).toHaveLength(1);
  view.unmount();
  await flush();
  expect(calls("app_window_release")).toHaveLength(0);
  await act(async () => {
    finish(true);
  });
  await flush();
  expect(native.invoke).toHaveBeenCalledWith("app_window_release", {
    hwnd: "101",
    dockId: args.dockId,
  });
  expect(windowEvents.stop).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("does not claim that a failed release opened a standalone window", async () => {
  render(<Pane />);
  await flush();
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "app_window_release") {
      throw new Error("Could not restore the window frame.");
    }
    return true;
  });
  fireEvent.click(screen.getByRole("button", { name: "Open as window" }));
  await flush();
  expect(screen.getByRole("alert").textContent).toContain("Could not restore");
  expect(screen.queryByRole("button", { name: "Show it here" })).toBeNull();
  await tick(2000);
  expect(screen.getByRole("alert").textContent).toContain("Could not restore");
  native.invoke.mockResolvedValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Open as window" }));
  await flush();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("open in its own window");
});

it("releases and reattaches with a fresh lease when the user opens the app as a window", async () => {
  render(<Pane />);
  await flush();
  const first = calls("app_window_dock")[0][1];
  fireEvent.click(screen.getByRole("button", { name: "Open as window" }));
  await flush();
  expect(native.invoke).toHaveBeenCalledWith("app_window_release", {
    hwnd: "101",
    dockId: first.dockId,
  });
  expect(screen.getByRole("status").textContent).toContain("open in its own window");
  fireEvent.click(screen.getByRole("button", { name: "Show it here" }));
  await flush();
  expect(calls("app_window_dock").at(-1)?.[1].dockId).not.toBe(first.dockId);
});
