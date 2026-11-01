import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const load = vi.fn();
const closeDb = vi.fn();
const invoke = vi.fn();
const loads = () => invoke.mock.calls.filter(([cmd]) => cmd === "plugin:sql|load");

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  load.mockResolvedValue("sqlite:panel.db");
  closeDb.mockResolvedValue(true);
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "plugin:sql|load") return load();
    if (cmd === "plugin:sql|close") return closeDb();
    return Promise.resolve(cmd === "plugin:sql|execute" ? [1, 1] : []);
  });
  // Exercise the real SQL plugin, mocking only the native IPC boundary.
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: { invoke } });
});
afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("shared SQLite connection", () => {
  it("opens once for concurrent project/calendar reads and writes", async () => {
    const { select, execute } = await import("@/common/storage/db");
    await Promise.all([select("projects"), select("calendar"), execute("update", [1])]);
    expect(loads()).toHaveLength(1);
    expect(loads()[0][1]).toEqual({ db: "sqlite:panel.db" });
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "plugin:sql|select")).toHaveLength(2);
    expect(invoke).toHaveBeenCalledWith(
      "plugin:sql|execute",
      { db: "sqlite:panel.db", query: "update", values: [1] },
      undefined,
    );
    await select("again");
    expect(loads()).toHaveLength(1);
  });

  it("retries a failed open instead of caching the rejection", async () => {
    load.mockRejectedValueOnce(new Error("unavailable"));
    const { select, execute } = await import("@/common/storage/db");
    const results = await Promise.allSettled([select("projects"), execute("update")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(loads()).toHaveLength(1);
    await select("retry");
    expect(loads()).toHaveLength(2);
  });

  it("closes an in-flight open and opens afresh on the next query", async () => {
    const { select, close } = await import("@/common/storage/db");
    await Promise.all([select("projects"), close()]);
    expect(closeDb).toHaveBeenCalledTimes(1);
    await select("reopen");
    expect(loads()).toHaveLength(2);
  });

  it("keeps the connection if close fails so it can be retried", async () => {
    const { select, close } = await import("@/common/storage/db");
    await select("projects");
    closeDb.mockRejectedValueOnce(new Error("busy"));
    await expect(close()).rejects.toThrow("busy");
    await close();
    expect(closeDb).toHaveBeenCalledTimes(2);
    await select("reopen");
    expect(loads()).toHaveLength(2);
  });
});
