import { afterEach, beforeEach, expect, it, vi } from "vitest";

const key = "panel:crash-log";
const now = Date.UTC(2026, 9, 17);
const record = (id: string, timestamp: number) => ({
  id,
  module: "test",
  kind: "global",
  message: "Diagnostic test record",
  stack: "",
  timestamp,
  recovered: false,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (name: string) => entries.get(name) ?? null,
    setItem: (name: string, value: string) => entries.set(name, value),
    removeItem: (name: string) => entries.delete(name),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("restores recent crashes only after policy loads and purges expired diagnostics", async () => {
  localStorage.setItem(
    key,
    JSON.stringify([record("c1_old", now - 2 * 86400000), record("c2_recent", now - 1000)]),
  );
  const store = await import("../../src/debug/data/crash-store");
  expect(store.getCrashes()).toEqual([]);
  store.configureCrashPersistence({ persistScrollback: true, retentionDays: 1 });
  expect(store.getCrashes().map((crash) => crash.id)).toEqual(["c2_recent"]);
  expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(1);

  vi.setSystemTime(now + 2 * 86400000);
  expect(store.getCrashCount()).toBe(0);
  expect(store.getCrashStats()).toEqual([]);
  expect(localStorage.getItem(key)).toBeNull();
});

it("disabled persistence deletes saved crashes and keeps new errors in memory only", async () => {
  localStorage.setItem(key, JSON.stringify([record("c1_recent", now)]));
  const store = await import("../../src/debug/data/crash-store");
  store.configureCrashPersistence({ persistScrollback: false, retentionDays: 7 });
  expect(localStorage.getItem(key)).toBeNull();
  expect(store.getCrashes()).toEqual([]);
  store.recordCrash("test", "global", "Current session error");
  expect(store.getCrashCount()).toBe(1);
  expect(localStorage.getItem(key)).toBeNull();
});

it("preserves startup errors and does not reload persisted crashes on repeated initialization", async () => {
  localStorage.setItem(key, JSON.stringify([record("c20_recent", now - 1000)]));
  const store = await import("../../src/debug/data/crash-store");
  store.recordCrash("test", "global", "Startup error");
  expect(JSON.parse(localStorage.getItem(key)!)[0].id).toBe("c20_recent");
  store.configureCrashPersistence({ persistScrollback: true, retentionDays: 7 });
  store.configureCrashPersistence({ persistScrollback: true, retentionDays: 7 });
  expect(store.getCrashCount()).toBe(2);
  store.recordCrash("test", "global", "Later error");
  expect(store.getCrashes()[2].id).toMatch(/^c21_/);
});
