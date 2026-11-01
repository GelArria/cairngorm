// Real SQLite writer contention + native WebView restart; no mocked IPC/database.
// Uses direct CDP because TesterArmy 0.20 navigates to about:blank, blocked by the app.
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { withQaProfile, waitFor } from "./qa-profile.mjs";

const bundle = await build({
  stdin: {
    contents:
      'export * from "./src/terminal/data/native-storage.ts"; export * from "./src/projects/data/project-store.ts"; export { getCrashes } from "./src/debug/data/crash-store.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  globalName: "storageQa",
  footer: { js: "globalThis.storageQa = storageQa;" },
  alias: { "@": path.resolve("src") },
});

await withQaProfile("storage-lock", async (qa) => {
  await qa.start();
  const data = path.dirname((await qa.invoke("config_read")).path);
  const dbPath = path.join(data, "panel.db");
  const db = new DatabaseSync(dbPath);
  const keys = ["qa-locked-workspace", "qa-locked-delete"];
  try {
    await qa.page.evaluate(bundle.outputFiles[0].text);
    await qa.page.evaluate(async (keys) => {
      for (const key of keys) {
        await storageQa.initializeStorage(key);
        storageQa.writeStored(key, "previous state");
      }
      await storageQa.flushStorage();
    }, keys);
    for (const key of keys) {
      assert.equal(
        db.prepare("SELECT value FROM terminal_state WHERE key=?").get(key).value,
        "previous state",
      );
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      await qa.page.evaluate(async (keys) => {
        storageQa.writeStored(keys[0], "newest state while SQLite is locked");
        storageQa.writeStored(keys[1], null);
        await storageQa.flushStorage();
      }, keys);
      assert.equal(
        db.prepare("SELECT value FROM terminal_state WHERE key=?").get(keys[0]).value,
        "previous state",
      );
      const fallback = await qa.page.evaluate(
        (keys) =>
          keys.map((key) => ({
            value: localStorage.getItem(key),
            stamp: Number(localStorage.getItem(`${key}:saved-at`)),
          })),
        keys,
      );
      assert.equal(fallback[0].value, "newest state while SQLite is locked");
      assert.equal(fallback[1].value, null);
      assert(fallback.every((row) => row.stamp > 0));
      // Closing only our QA child tests recovery from an interrupted process, not a mock reload.
      await qa.stop();
    } finally {
      db.exec("ROLLBACK");
    }
    await qa.start();
    await qa.page.evaluate(bundle.outputFiles[0].text);
    const recovered = await qa.page.evaluate(async (keys) => {
      const values = [];
      for (const key of keys) {
        await storageQa.initializeStorage(key);
        values.push(storageQa.peekStored(key));
        storageQa.writeStored(key, storageQa.peekStored(key));
      }
      await storageQa.flushStorage();
      return values;
    }, keys);
    assert.deepEqual(recovered, ["newest state while SQLite is locked", null]);
    assert.equal(
      db.prepare("SELECT value FROM terminal_state WHERE key=?").get(keys[0]).value,
      recovered[0],
    );
    assert.equal(
      db.prepare("SELECT value FROM terminal_state WHERE key=?").get(keys[1]),
      undefined,
    );
    assert.deepEqual(
      await qa.page.evaluate(
        (keys) =>
          keys.flatMap((key) => [
            localStorage.getItem(key),
            localStorage.getItem(`${key}:saved-at`),
          ]),
        keys,
      ),
      [null, null, null, null],
    );
    await qa.stop();
    await qa.start();
    await qa.page.evaluate(bundle.outputFiles[0].text);
    const final = await qa.page.evaluate(async (keys) => {
      const values = [];
      for (const key of keys) {
        await storageQa.initializeStorage(key);
        values.push(storageQa.peekStored(key));
      }
      return values;
    }, keys);
    assert.deepEqual(final, recovered);
    await qa.page.evaluate(() => storageQa.initProjects());
    const project = await qa.page.evaluate(() => storageQa.getActiveProject());
    db.exec("BEGIN IMMEDIATE");
    try {
      await qa.page.evaluate(
        (id) => storageQa.renameProject(id, "Recovered project name"),
        project.id,
      );
      await waitFor(
        () =>
          qa.page.evaluate(() =>
            storageQa
              .getCrashes()
              .some((crash) => crash.module === "projects" && /locked|busy/i.test(crash.message)),
          ),
        "Project write did not reach real SQLite contention",
      );
      await qa.stop();
    } finally {
      db.exec("ROLLBACK");
    }
    await qa.start();
    await qa.page.evaluate(bundle.outputFiles[0].text);
    await qa.page.evaluate(() => storageQa.initProjects());
    const restoredProject = await qa.page.evaluate(
      (id) => storageQa.getProjectsState().projects.find((p) => p.id === id),
      project.id,
    );
    assert.equal(restoredProject.name, "Recovered project name");
    await qa.page.getByTestId("splash").waitFor({ state: "hidden" });
    await qa.page.addLocatorHandler(
      qa.page.getByRole("dialog", { name: "Claude Code uses paid API billing" }),
      async (dialog) => {
        await dialog.getByRole("button", { name: "Not now", exact: true }).click();
      },
    );
    await qa.page.addLocatorHandler(
      qa.page.getByRole("dialog", { name: "Set up the Cairngorm agent" }),
      async (dialog) => {
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
      },
    );
    const picker = qa.page.getByRole("button", { name: "Choose project", exact: true });
    await picker.waitFor({ state: "visible" });
    await waitFor(
      async () => (await picker.textContent()).includes(restoredProject.name),
      "The native UI did not restore the project name",
    );
    await picker.click();
    await qa.page.screenshot({ path: path.join(qa.scratch, "project-recovered.png") });
    assert.equal(
      db.prepare("SELECT name FROM projects WHERE id=?").get(project.id).name,
      restoredProject.name,
    );
    return {
      projectRenameRecovered: true,
      nativeSqliteLock: true,
      recoveryAfterProcessRestart: true,
      deletionNotResurrected: true,
      reconciledToSqlite: true,
      secondRestart: true,
    };
  } finally {
    db.close();
  }
});
