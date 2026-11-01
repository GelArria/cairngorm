import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  execute: vi.fn(),
  stored: new Map<string, string | null>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/common/storage/db", () => ({ execute: mocks.execute }));
vi.mock("../../src/terminal/data/native-storage", () => ({
  nativeStorageAvailable: () => true,
  readStored: async (key: string) => mocks.stored.get(key),
  writeStored: (key: string, value: string | null) => mocks.stored.set(key, value),
}));
beforeEach(() => {
  vi.resetModules();
  mocks.stored.clear();
  mocks.execute.mockReset();
  const entries: Record<string, string> = {};
  Object.defineProperties(entries, {
    getItem: { value: (key: string) => entries[key] ?? null },
    setItem: {
      value: (key: string, value: string) => {
        entries[key] = value;
      },
    },
    removeItem: {
      value: (key: string) => {
        delete entries[key];
      },
    },
  });
  vi.stubGlobal("localStorage", entries);
});
afterEach(() => vi.unstubAllGlobals());

it("disabled persistence clears old history and prevents new writes", async () => {
  mocks.invoke.mockResolvedValue({ persistScrollback: false, retentionDays: 7 });
  localStorage.setItem("panel-scrollback:old", "private");
  localStorage.setItem("panel:crash-log", "[]");
  const { initializeScrollbackPolicy } =
    await import("../../src/terminal/runtime/scrollback-policy");
  await initializeScrollbackPolicy();
  const history = await import("../../src/terminal/data/scrollback-store");
  history.saveScrollback("session", "private");
  expect(await history.loadScrollback("session")).toBeUndefined();
  expect(mocks.stored.size).toBe(0);
  expect(localStorage.getItem("panel-scrollback:old")).toBeNull();
  expect(localStorage.getItem("panel:crash-log")).toBeNull();
  expect(mocks.execute).toHaveBeenCalledWith(
    "DELETE FROM terminal_state WHERE key LIKE 'panel-scrollback:%'",
  );
});

it("unavailable native policy disables crash persistence", async () => {
  mocks.invoke.mockRejectedValue(new Error("Native policy unavailable"));
  localStorage.setItem("panel:crash-log", "[]");
  const { initializeScrollbackPolicy } =
    await import("../../src/terminal/runtime/scrollback-policy");
  await initializeScrollbackPolicy();
  const crashes = await import("../../src/debug/data/crash-store");
  crashes.recordCrash("test", "global", "Current session error");
  expect(localStorage.getItem("panel:crash-log")).toBeNull();
});

it("keeps recent history across initialization and expires old sessions", async () => {
  mocks.invoke.mockResolvedValue({ persistScrollback: true, retentionDays: 1 });
  const { initializeScrollbackPolicy } =
    await import("../../src/terminal/runtime/scrollback-policy");
  await initializeScrollbackPolicy();
  const history = await import("../../src/terminal/data/scrollback-store");
  history.saveScrollback("session", "recent");
  await initializeScrollbackPolicy();
  expect(await history.loadScrollback("session")).toBe("recent");
  localStorage.setItem("panel-scrollback:session:retained-at", String(Date.now() - 2 * 86400000));
  expect(await history.loadScrollback("session")).toBeUndefined();
  expect(mocks.stored.get("panel-scrollback:session")).toBeNull();
});
