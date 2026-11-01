// The break: SQLite cannot be opened (locked by a second instance, broken file) and the app
// silently keeps changes only in WebView storage, so the user loses them on the next start
// without ever being told. The terminal store's real fallback path must raise the notice.
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  execute: vi.fn(async () => {}),
  select: vi.fn(async (): Promise<unknown[]> => []),
}));
vi.mock("../../src/common/storage/db", () => db);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ destroy: vi.fn(async () => {}), onCloseRequested: vi.fn() }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("tells the user when terminal state cannot use the database", async () => {
  const { StorageWarning } = await import("@/app/app-header/storage-warning");
  const storage = await import("@/terminal/data/native-storage");
  render(<StorageWarning />);
  expect(screen.queryByTestId("storage-warning")).toBeNull();

  db.select.mockRejectedValueOnce(new Error("database is locked"));
  await storage.initializeStorage("cairngorm-terminal-workspace-v1");
  expect(storage.nativeStorageAvailable()).toBe(false);
  fireEvent.click(await screen.findByTestId("storage-warning"));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Terminals could not be saved to Cairngorm's database",
  );
});

it("names both areas when projects fail too, and stays quiet when the database works", async () => {
  const health = await import("@/common/storage/storage-health");
  const storage = await import("@/terminal/data/native-storage");
  await storage.initializeStorage("cairngorm-terminal-workspace-v1");
  expect(health.storageFallbacks()).toEqual([]);
  health.reportStorageFallback("projects", new Error("locked"));
  health.reportStorageFallback("terminals", new Error("locked"));
  expect(health.storageFallbackMessage(health.storageFallbacks())).toMatch(
    /^Projects and terminals could not be saved/,
  );
});
