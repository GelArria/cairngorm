import { act, cleanup, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn(), unlisten: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
import { useBrowserPreview } from "../../src/testing/hooks/use-browser-preview";

beforeEach(() => {
  native.invoke.mockReset().mockResolvedValue(undefined);
  native.listen.mockReset().mockResolvedValue(native.unlisten);
  native.unlisten.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const surface = document.createElement("div");
  document.body.append(surface);
  surface.getBoundingClientRect = () =>
    ({ x: 10, y: 100, right: 610, bottom: 500, width: 600, height: 400 }) as DOMRect;
  const hook = renderHook(() => useBrowserPreview());
  hook.result.current.surface.current = surface;
  return { hook, surface };
}

it("closes a late-created native webview after the panel has already unmounted", async () => {
  let release!: () => void;
  native.invoke.mockImplementation((_command, args) =>
    args.action === "open"
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : Promise.resolve(),
  );
  const { hook, surface } = mount();
  await waitFor(() => expect(native.listen).toHaveBeenCalled());
  let opening!: Promise<void>;
  act(() => {
    opening = hook.result.current.navigate("localhost:3000");
  });
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "test_preview",
      expect.objectContaining({ action: "open", url: "http://localhost:3000/" }),
    ),
  );
  hook.unmount();
  release();
  await opening;
  await waitFor(() =>
    expect(native.invoke.mock.calls.map(([, args]) => args.action)).toEqual(["open", "close"]),
  );
  expect(native.unlisten).toHaveBeenCalledOnce();
  surface.remove();
});

it("rejects unsafe addresses before calling native navigation and keeps errors visible", async () => {
  const { hook, surface } = mount();
  await waitFor(() => expect(native.listen).toHaveBeenCalled());
  await act(async () => {
    await hook.result.current.navigate("javascript:alert(1)");
  });
  expect(native.invoke).not.toHaveBeenCalled();
  expect(hook.result.current.state.error).toContain("Only HTTP and HTTPS");
  expect(hook.result.current.state.loading).toBe(false);
  surface.remove();
});

it("hides the native view behind menus and restores it after the overlay closes", async () => {
  const { hook, surface } = mount();
  await waitFor(() => expect(native.listen).toHaveBeenCalled());
  await act(async () => {
    await hook.result.current.navigate("localhost:3000");
  });
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  document.body.append(menu);
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "test_preview",
      expect.objectContaining({ action: "layout", visible: false }),
    ),
  );
  native.invoke.mockClear();
  menu.remove();
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "test_preview",
      expect.objectContaining({ action: "layout", visible: true }),
    ),
  );
  native.invoke.mockClear();
  surface.getBoundingClientRect = () =>
    ({ x: 0, y: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
  window.dispatchEvent(new Event("resize"));
  await waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith(
      "test_preview",
      expect.objectContaining({ action: "layout", visible: false }),
    ),
  );
  surface.remove();
});

it("ignores descendant style churn instead of scheduling native layouts", async () => {
  const { hook, surface } = mount();
  await waitFor(() => expect(native.listen).toHaveBeenCalled());
  await act(async () => {
    await hook.result.current.navigate("localhost:3000");
  });
  native.invoke.mockClear();
  const child = document.createElement("div");
  surface.append(child);
  child.setAttribute("style", "transform: translateX(1px)");
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(native.invoke).not.toHaveBeenCalled();
  surface.remove();
});

it.each(["Enter", " ", "wheel", "blur", "click"])(
  "restores the preview after an inline menu closes via %s",
  async (event) => {
    const { hook, surface } = mount();
    await waitFor(() => expect(native.listen).toHaveBeenCalled());
    await act(async () => {
      await hook.result.current.navigate("localhost:3000");
    });
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    surface.append(menu);
    window.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "test_preview",
        expect.objectContaining({ action: "layout", visible: false }),
      ),
    );
    native.invoke.mockClear();
    act(() => {
      window.dispatchEvent(
        event === "Enter" || event === " "
          ? new KeyboardEvent("keydown", { key: event })
          : new Event(event),
      );
      menu.remove();
    });
    await waitFor(() =>
      expect(native.invoke).toHaveBeenCalledWith(
        "test_preview",
        expect.objectContaining({ action: "layout", visible: true }),
      ),
    );
    surface.remove();
  },
);

it("coalesces native layout calls while a bounds update is in flight", async () => {
  const { hook, surface } = mount();
  await waitFor(() => expect(native.listen).toHaveBeenCalled());
  await act(async () => {
    await hook.result.current.navigate("localhost:3000");
  });
  native.invoke.mockClear();
  let release!: () => void;
  native.invoke.mockImplementation((_command, args) =>
    args.action === "layout"
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : Promise.resolve(),
  );
  act(() => window.dispatchEvent(new Event("resize")));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledOnce());
  surface.getBoundingClientRect = () =>
    ({ x: 10, y: 100, right: 510, bottom: 500, width: 500, height: 400 }) as DOMRect;
  act(() => {
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
  });
  expect(native.invoke).toHaveBeenCalledOnce();
  release();
  await waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
  surface.remove();
});
