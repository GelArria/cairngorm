import { act, cleanup, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { useDetachedCloseEvents } from "../../src/terminal/hooks/use-detached-close-events";
import type { TermTab } from "../../src/terminal/model/types";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const tab = (id: string): TermTab => ({
  id,
  title: id,
  sessionId: id,
  profile: "shell",
  status: "running",
  detached: false,
});
const callbacks = new Map<string, () => void>();
const unlisteners = new Map<string, ReturnType<typeof vi.fn>>();

beforeEach(() => {
  callbacks.clear();
  unlisteners.clear();
  vi.clearAllMocks();
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    const off = vi.fn();
    callbacks.set(event, () => callback({ event, id: 1, payload: {} }));
    unlisteners.set(event, off);
    return off;
  });
});
afterEach(cleanup);

it("closes a member created inside the detached window and keeps original listeners stable", async () => {
  const closeTab = vi.fn();
  const { rerender, unmount } = renderHook(({ tabs }) => useDetachedCloseEvents(tabs, closeTab), {
    initialProps: { tabs: [tab("original")] },
  });
  await act(async () => {});
  rerender({ tabs: [tab("original"), tab("new-split")] });
  await act(async () => {});
  callbacks.get("pty-kill-new-split")!();
  expect(closeTab).toHaveBeenCalledWith("new-split", true);
  expect(listen).toHaveBeenCalledTimes(2);
  expect(unlisteners.get("pty-kill-original")).not.toHaveBeenCalled();
  rerender({ tabs: [tab("original")] });
  expect(unlisteners.get("pty-kill-new-split")).toHaveBeenCalledOnce();
  closeTab.mockClear();
  callbacks.get("pty-kill-new-split")!();
  expect(closeTab).not.toHaveBeenCalled();
  unmount();
  expect(unlisteners.get("pty-kill-original")).toHaveBeenCalledOnce();
});

it("cleans up a pending asynchronous subscription after unmount", async () => {
  let resolve!: (off: () => void) => void;
  vi.mocked(listen).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { unmount } = renderHook(() => useDetachedCloseEvents([tab("pending")], vi.fn()));
  unmount();
  const off = vi.fn();
  await act(async () => {
    resolve(off);
  });
  expect(off).toHaveBeenCalledOnce();
});
