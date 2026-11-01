import { act, cleanup, render, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { AppWindowPane } from "@/plugins/app-window-pane";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onMoved: async () => () => {},
    onResized: async () => () => {},
    onScaleChanged: async () => () => {},
  }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("allows revision B to attach after revision A's release reports a restoration failure", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "app_window_release") {
      throw new Error("Old application window is not responding");
    }
    return true;
  });
  const pane = (hwnd: string) => (
    <AppWindowPane
      hwnd={hwnd}
      appId="word"
      appName="Word"
      sourceTitle="Agent"
      onShowTerminal={() => {}}
      onReopened={() => {}}
    />
  );
  const view = render(pane("101"));
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "app_window_dock",
      expect.objectContaining({ hwnd: "101" }),
    ),
  );
  view.rerender(pane("202"));
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "app_window_dock",
      expect.objectContaining({ hwnd: "202" }),
    ),
  );
  expect(warning).toHaveBeenCalledWith("Could not restore application window", expect.any(Error));
  native.invoke.mockResolvedValue(true);
});

it("finishes and releases revision A's pending dock before attaching revision B", async () => {
  let finish!: (alive: boolean) => void;
  native.invoke.mockReset().mockImplementation((command: string, args: { hwnd: string }) =>
    command === "app_window_dock" && args.hwnd === "101"
      ? new Promise<boolean>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(true),
  );
  const pane = (hwnd: string) => (
    <AppWindowPane
      hwnd={hwnd}
      appId="word"
      appName="Microsoft Word"
      sourceTitle="Agent"
      onShowTerminal={() => {}}
      onReopened={() => {}}
    />
  );
  const view = render(pane("101"));
  await act(async () => {});
  expect(native.invoke).toHaveBeenCalledWith(
    "app_window_dock",
    expect.objectContaining({ hwnd: "101" }),
  );
  view.rerender(pane("202"));
  await act(async () => {});
  expect(native.invoke).not.toHaveBeenCalledWith(
    "app_window_dock",
    expect.objectContaining({ hwnd: "202" }),
  );
  await act(async () => {
    finish(true);
  });
  await waitFor(() => {
    const commands = native.invoke.mock.calls.map(([command, args]) => [command, args.hwnd]);
    expect(commands.slice(0, 3)).toEqual([
      ["app_window_dock", "101"],
      ["app_window_release", "101"],
      ["app_window_dock", "202"],
    ]);
  });
  view.rerender(pane("101"));
  await act(async () => {});
  await waitFor(() => {
    expect(
      native.invoke.mock.calls.slice(-2).map(([command, args]) => [command, args.hwnd]),
    ).toEqual([
      ["app_window_release", "202"],
      ["app_window_dock", "101"],
    ]);
  });
  await act(async () => {
    finish(true);
  });
});
