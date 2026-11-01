import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const endpoint = process.env.NATIVE_CDP_URL;
assert.ok(endpoint && !endpoint.includes(":9222"), "Use an isolated native QA app");
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((page) => page.url() === "http://localhost:1420/");
  assert.ok(page, "Unmocked native QA window required");
  const result = await page.evaluate(async () => {
    const storage = await import("/src/terminal/data/native-storage.ts");
    const history = await import("/src/terminal/data/scrollback-store.ts");
    const key = "native-qa-state";
    const internal = window.__TAURI_INTERNALS__;
    const invoke = internal.invoke;
    await storage.flushStorage();
    await invoke("plugin:sql|execute", {
      db: "sqlite:panel.db",
      query: "DELETE FROM terminal_state WHERE key = ?",
      values: [key],
    });
    localStorage.setItem(key, "legacy");
    await storage.initializeStorage(key);
    if (storage.peekStored(key) !== "legacy") throw new Error("Legacy migration failed");
    storage.writeStored(key, storage.peekStored(key));
    await storage.flushStorage();
    const migrated = await invoke("plugin:sql|select", {
      db: "sqlite:panel.db",
      query: "SELECT value FROM terminal_state WHERE key=?",
      values: [key],
    });
    if (migrated[0]?.value !== "legacy" || localStorage.getItem(key) !== null)
      throw new Error("Legacy copy not committed before removal");
    let legacyWrites = 0,
      serializations = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, value) {
      if (k === key) legacyWrites++;
      return setItem.call(this, k, value);
    };
    const start = performance.now();
    for (let n = 0; n < 1000; n++)
      storage.writeStored(key, () => {
        serializations++;
        return String(n);
      });
    history.saveScrollback("native-persistence-qa", "x".repeat(100000));
    await storage.flushStorage();
    const elapsedMs = performance.now() - start;
    Storage.prototype.setItem = setItem;
    const rows = await invoke("plugin:sql|select", {
      db: "sqlite:panel.db",
      query: "SELECT key,value FROM terminal_state WHERE key IN (?,?)",
      values: [key, "panel-scrollback:native-persistence-qa"],
    });
    const latest = rows.find((row) => row.key === key)?.value;
    const historyBytes = rows.find((row) => row.key.startsWith("panel-scrollback:"))?.value.length;
    if (latest !== "999" || historyBytes !== 100000 || localStorage.getItem(key) !== null)
      throw new Error("SQLite did not persist the complete batch");
    await invoke("plugin:sql|execute", {
      db: "sqlite:panel.db",
      query: `CREATE TRIGGER native_qa_failure BEFORE INSERT ON terminal_state
      WHEN NEW.key = 'native-qa-state' BEGIN SELECT RAISE(ABORT, 'QA write failure'); END`,
      values: [],
    });
    try {
      storage.writeStored(key, "recovered");
      await storage.flushStorage();
    } finally {
      await invoke("plugin:sql|execute", {
        db: "sqlite:panel.db",
        query: "DROP TRIGGER native_qa_failure",
        values: [],
      });
    }
    if (localStorage.getItem(key) !== "recovered")
      throw new Error("Missing recovery copy after actual SQLite failure");
    await storage.initializeStorage(key);
    if (storage.peekStored(key) !== "recovered") throw new Error("Recovery lost the newest state");
    storage.writeStored(key, null);
    history.clearScrollback("native-persistence-qa");
    await storage.flushStorage();
    return {
      legacyWrites,
      serializations,
      historyBytes,
      elapsedMs,
      migration: true,
      recovery: true,
    };
  });
  assert.equal(result.legacyWrites, 0);
  assert.equal(result.serializations, 1);
  console.log(
    "PASS: native SQLite migration, actual write failure recovery, 1000 updates -> 1 serialization, 100000-character history",
    JSON.stringify(result),
  );
} finally {
  await browser.close();
}
