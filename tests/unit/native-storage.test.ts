import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  execute: vi.fn(async (_query: string, _values?: unknown[]) => {}),
  select: vi.fn(
    async (
      _query: string,
      _values?: unknown[],
    ): Promise<{ value: string | null; updated_at: number }[]> => [],
  ),
}));
vi.mock("../../src/common/storage/db", () => db);
const windowMock = vi.hoisted(() => ({
  destroy: vi.fn(async () => {}),
  onCloseRequested: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowMock }));
const saved = new Map<string, string>();
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db.select.mockResolvedValue([]);
  db.execute.mockResolvedValue(undefined);
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("migrates only validated workspace state and strips credentials before native persistence", async () => {
  const key = "cairngorm-terminal-workspace-v1";
  saved.set(
    key,
    JSON.stringify({
      version: 1,
      state: {
        groups: [{ id: "g1", name: "Main" }],
        tabs: [
          {
            id: "1",
            sessionId: "term-1",
            title: "Agent",
            isAgent: true,
            shellEnv: { API_KEY: "never-save-secret" },
          },
        ],
        activeGroupId: "g1",
        activeTabId: "1",
        layout: null,
        savedLayouts: {},
      },
    }),
  );
  const workspace = await import("../../src/terminal/data/workspace-storage");
  await workspace.initializeWorkspaceStorage();
  expect(db.execute.mock.calls[0][1]?.[1]).not.toContain("never-save-secret");
  expect(saved.has(key)).toBe(false);
  expect(workspace.loadWorkspace()?.tabs[0].sessionId).toBe("term-1");
});
it("groups latest values in one transaction without synchronous localStorage writes", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  for (let i = 0; i < 200; i++) store.writeStored("workspace", String(i));
  store.writeStored("history", "full history");
  expect(saved.size).toBe(0);
  await store.flushStorage();
  expect(db.execute).toHaveBeenCalledTimes(1);
  expect(db.execute.mock.calls[0][1]).toEqual([
    "workspace",
    "199",
    expect.any(Number),
    "history",
    "full history",
    expect.any(Number),
  ]);
});
it("pending and committed deletions do not resurrect a legacy value", async () => {
  saved.set("history", "old");
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("history");
  store.writeStored("history", null);
  expect(store.peekStored("history")).toBeNull();
  await store.flushStorage();
  expect(store.peekStored("history")).toBeNull();
  expect(saved.has("history")).toBe(false);
});
it("falls back without native SQLite and retains a recovery copy after a write failure", async () => {
  db.select.mockRejectedValueOnce(new Error("unavailable"));
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  store.writeStored("workspace", "legacy");
  expect(saved.get("workspace")).toBe("legacy");
  await store.initializeStorage("workspace");
  db.execute.mockRejectedValue(new Error("disk busy"));
  store.writeStored("workspace", "newest");
  await store.flushStorage();
  expect(saved.get("workspace")).toBe("newest");
  expect(Number(saved.get("workspace:saved-at"))).toBeGreaterThan(0);
});
it("a pending write arriving during an asynchronous read wins over an older SQLite row", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  let resolve!: (rows: { value: string | null; updated_at: number }[]) => void;
  db.select.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const reading = store.readStored("history");
  await Promise.resolve();
  store.writeStored("history", "newest");
  resolve([{ value: "old", updated_at: 1 }]);
  expect(await reading).toBe("newest");
  await store.flushStorage();
});
it("newer recovery deletions and SQLite tombstones never resurrect legacy history", async () => {
  saved.set("history:saved-at", "200");
  db.select.mockResolvedValue([{ value: "old", updated_at: 100 }]);
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("history");
  expect(store.peekStored("history")).toBeNull();
  expect(await store.readStored("history")).toBeNull();
  saved.set("history", "obsolete legacy");
  saved.delete("history:saved-at");
  db.select.mockResolvedValue([{ value: null, updated_at: 300 }]);
  await store.initializeStorage("history");
  expect(store.peekStored("history")).toBeNull();
});
it("failed saves remain retryable when both SQLite and the recovery copy are unavailable", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  db.execute.mockRejectedValueOnce(new Error("disk busy"));
  const setItem = vi.fn(() => {
    throw new Error("quota");
  });
  vi.stubGlobal("localStorage", { getItem: () => null, removeItem: () => {}, setItem });
  store.writeStored("workspace", "must survive");
  await expect(store.flushStorage()).rejects.toThrow("quota");
  expect(store.peekStored("workspace")).toBe("must survive");
  await store.flushStorage();
  expect(db.execute.mock.calls[1][1]?.[1]).toBe("must survive");
});
it("a failed save in the same millisecond is newer than the committed SQLite row", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  db.select.mockResolvedValue([{ value: "old", updated_at: 1000 }]);
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  db.execute.mockRejectedValueOnce(new Error("busy"));
  store.writeStored("workspace", "newest");
  await store.flushStorage();
  await store.initializeStorage("workspace");
  expect(store.peekStored("workspace")).toBe("newest");
});
it("close prevents destruction until the complete pending batch has committed", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  let close!: (event: { preventDefault(): void }) => Promise<void>;
  windowMock.onCloseRequested.mockImplementationOnce(async (callback) => {
    close = callback;
    return () => {};
  });
  await store.installStorageCloseGuard();
  let finish!: () => void;
  db.execute.mockImplementationOnce(
    () =>
      new Promise((done) => {
        finish = done;
      }),
  );
  store.writeStored("workspace", "latest");
  const event = { preventDefault: vi.fn() };
  const closing = close(event);
  await Promise.resolve();
  await Promise.resolve();
  expect(event.preventDefault).toHaveBeenCalled();
  expect(windowMock.destroy).not.toHaveBeenCalled();
  finish();
  await closing;
  expect(windowMock.destroy).toHaveBeenCalledOnce();
});
it("committed histories are not retained in the synchronous workspace cache", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  store.writeStored("history", "x".repeat(100000));
  await store.flushStorage();
  expect(store.peekStored("history")).toBeNull();
  db.select.mockResolvedValue([{ value: "from SQLite", updated_at: 1 }]);
  expect(await store.readStored("history")).toBe("from SQLite");
});
it("close awaits registered detached cleanup, and unregister removes it", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  let close!: (event: { preventDefault(): void }) => Promise<void>;
  windowMock.onCloseRequested.mockImplementationOnce(async (callback) => {
    close = callback;
    return () => {};
  });
  await store.installStorageCloseGuard();
  let finish!: () => void;
  const cleanup = vi.fn(
    () =>
      new Promise<void>((done) => {
        finish = done;
      }),
  );
  const unregister = store.registerStorageCloseCleanup(cleanup);
  const closing = close({ preventDefault: vi.fn() });
  await Promise.resolve();
  await Promise.resolve();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(windowMock.destroy).not.toHaveBeenCalled();
  finish();
  await closing;
  expect(windowMock.destroy).toHaveBeenCalledOnce();
  unregister();
  windowMock.onCloseRequested.mockImplementationOnce(async (callback) => {
    close = callback;
    return () => {};
  });
  await store.installStorageCloseGuard();
  await close({ preventDefault: vi.fn() });
  expect(cleanup).toHaveBeenCalledOnce();
});
it("a rejected live-session snapshot prevents destruction and cancels close preparation", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  let close!: (event: { preventDefault(): void }) => Promise<void>;
  windowMock.onCloseRequested.mockImplementationOnce(async (callback) => {
    close = callback;
    return () => {};
  });
  const snapshot = vi.fn().mockRejectedValueOnce(new Error("Session snapshot unavailable"));
  const abort = vi.fn(async () => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await store.installStorageCloseGuard({ beforeDestroy: snapshot, onCloseAborted: abort });
  await close({ preventDefault: vi.fn() });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(abort).toHaveBeenCalledOnce();
  expect(windowMock.destroy).not.toHaveBeenCalled();
  snapshot.mockResolvedValueOnce(undefined);
  await close({ preventDefault: vi.fn() });
  expect(windowMock.destroy).toHaveBeenCalledOnce();
});
it("a window kept running in the background saves state but is never destroyed", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  let close!: (event: { preventDefault(): void }) => Promise<void>;
  windowMock.onCloseRequested.mockImplementationOnce(async (callback) => {
    close = callback;
    return () => {};
  });
  const check = vi.fn(async () => true);
  store.registerStorageCloseCheck(check);
  const snapshot = vi.fn(async () => {});
  const keepRunning = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await store.installStorageCloseGuard({ beforeDestroy: snapshot, keepRunning });
  store.writeStored("workspace", "latest");
  await close({ preventDefault: vi.fn() });
  expect(db.execute).toHaveBeenCalled();
  expect(check).not.toHaveBeenCalled();
  expect(snapshot).not.toHaveBeenCalled();
  expect(windowMock.destroy).not.toHaveBeenCalled();
  // The next close (e.g. after the agents finished) goes through the normal path.
  await close({ preventDefault: vi.fn() });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(windowMock.destroy).toHaveBeenCalledOnce();
});
it("native history is larger than the legacy quota cap and loads asynchronously", async () => {
  const store = await import("../../src/terminal/data/native-storage");
  await store.initializeStorage("workspace");
  const history = await import("../../src/terminal/data/scrollback-store");
  history.saveScrollback("session", "x".repeat(100000));
  expect(await history.loadScrollback("session")).toHaveLength(100000);
  await store.flushStorage();
});
