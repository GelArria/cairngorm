import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  destroy: vi.fn(),
  onCloseRequested: vi.fn(),
}));
vi.mock("@/common/storage/db", () => mocks);
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => mocks }));
let close: (event: { preventDefault(): void }) => Promise<void>;
let store: typeof import("@/terminal/data/native-storage");

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  mocks.select.mockResolvedValue([]);
  mocks.execute.mockResolvedValue(undefined);
  mocks.destroy.mockResolvedValue(undefined);
  mocks.onCloseRequested.mockImplementation(async (callback) => {
    close = callback;
    return vi.fn();
  });
  store = await import("@/terminal/data/native-storage");
  await store.initializeStorage("workspace");
});
afterEach(() => vi.unstubAllGlobals());

it("reaffirms native close admission after a delayed storage flush and before destruction", async () => {
  let finish!: () => void;
  mocks.execute.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const order: string[] = [];
  const beforeDestroy = vi.fn(async () => {
    order.push("release-and-block-docks");
  });
  const onCloseAborted = vi.fn();
  mocks.destroy.mockImplementationOnce(async () => {
    order.push("destroy");
  });
  await store.installStorageCloseGuard({ beforeDestroy, onCloseAborted });
  store.writeStored("workspace", "latest");
  const closing = close({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(beforeDestroy).not.toHaveBeenCalled();
  expect(mocks.destroy).not.toHaveBeenCalled();
  finish();
  await closing;
  expect(order).toEqual(["release-and-block-docks", "destroy"]);
  expect(onCloseAborted).not.toHaveBeenCalled();
});

it("resumes native docking if the user cancels a close", async () => {
  const onCloseAborted = vi.fn(async () => {});
  const beforeDestroy = vi.fn(async () => {});
  store.registerStorageCloseCheck(async () => false);
  await store.installStorageCloseGuard({ beforeDestroy, onCloseAborted });
  await close({ preventDefault: vi.fn() });
  expect(onCloseAborted).toHaveBeenCalledOnce();
  expect(beforeDestroy).not.toHaveBeenCalled();
  expect(mocks.destroy).not.toHaveBeenCalled();
});

it("resumes docking when destruction fails and retries close normally", async () => {
  const onCloseAborted = vi.fn(async () => {});
  const beforeDestroy = vi.fn(async () => {});
  mocks.destroy.mockRejectedValueOnce(new Error("window could not close"));
  await store.installStorageCloseGuard({ beforeDestroy, onCloseAborted });
  await close({ preventDefault: vi.fn() });
  expect(onCloseAborted).toHaveBeenCalledOnce();
  await close({ preventDefault: vi.fn() });
  expect(beforeDestroy).toHaveBeenCalledTimes(2);
  expect(mocks.destroy).toHaveBeenCalledTimes(2);
});

it("refuses destruction when native application windows could not be restored", async () => {
  const onCloseAborted = vi.fn(async () => {});
  await store.installStorageCloseGuard({
    beforeDestroy: async () => {
      throw new Error("application window restoration failed");
    },
    onCloseAborted,
  });
  await close({ preventDefault: vi.fn() });
  expect(mocks.destroy).not.toHaveBeenCalled();
  expect(onCloseAborted).toHaveBeenCalledOnce();
});
