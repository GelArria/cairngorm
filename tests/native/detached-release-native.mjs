// Packaged UI + release backend; QA main and bundled factory use matching isolated CDP args.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { build } from "vite";
import { withQaProfile } from "./qa-profile.mjs";

// The production factory imports the base config, not Tauri's QA override. Instrument
// only that bundled config so dynamic QA webviews expose the same isolated CDP endpoint.
assert.equal(process.platform, "win32");
const configFile = path.resolve("src-tauri/tauri.conf.json").replaceAll("\\", "/");
const qaConfig = JSON.parse(fs.readFileSync("tests/tauri.fresh-profile.json", "utf8"));
let instrumented = false;
await build({
  plugins: [
    {
      name: "qa-window-browser-args",
      enforce: "pre",
      load(id) {
        if (id.replaceAll("\\", "/") !== configFile) return;
        const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
        config.app.windows[0].additionalBrowserArgs = qaConfig.app.windows[0].additionalBrowserArgs;
        instrumented = true;
        return JSON.stringify(config);
      },
    },
  ],
});
assert(instrumented, "QA browser arguments were not applied to the bundled factory");
const built = spawnSync(
  process.execPath,
  [
    "node_modules/@tauri-apps/cli/tauri.js",
    "build",
    "--no-bundle",
    "--config",
    "tests/tauri.fresh-profile.json",
    "--config",
    JSON.stringify({ build: { beforeBuildCommand: "" } }),
  ],
  {
    env: {
      ...process.env,
      CARGO_TARGET_DIR: path.resolve("src-tauri/target/perf-baseline"),
      CARGO_BUILD_JOBS: "2",
    },
    stdio: "inherit",
    timeout: 600000,
  },
);
assert.equal(built.status, 0, "Isolated release build failed; no app was launched");

await withQaProfile("detached-release", async (qa) => {
  const root = path.join(qa.scratch, "project");
  let browser;
  const snapshot = (page) =>
    page.evaluate(async () => {
      const rows = await window.__TAURI_INTERNALS__.invoke("plugin:sql|select", {
        db: "sqlite:panel.db",
        query: "SELECT value FROM terminal_state WHERE key=?",
        values: ["cairngorm-terminal-workspace-v1"],
      });
      return JSON.parse(rows[0]?.value ?? "null")?.state;
    });
  const invoke = (page, command, args) =>
    page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
      command,
      args,
    });
  async function launch() {
    const page = await qa.start();
    browser = page.context().browser();
    await page.waitForURL(/tauri\.localhost/);
    await page.evaluate(() => {
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("sidebar-side", "left");
    });
    await page.reload();
    await page.getByTestId("sidebar").waitFor();
    await page.addLocatorHandler(
      page.getByRole("dialog", { name: "Claude Code uses paid API billing" }),
      async (dialog) => {
        await dialog.getByRole("button", { name: "Not now", exact: true }).click();
      },
    );
    await page.addLocatorHandler(
      page.getByRole("dialog", { name: "Set up the Cairngorm agent" }),
      async (dialog) => {
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
      },
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await invoke(page, "is_debug", {}), false, "Must exercise the release backend");
    return page;
  }
  async function stop() {
    await qa.stop();
    browser = undefined;
  }
  const owned = ["release-first", "release-second"].map((id) => ({
    id,
    sessionId: id,
    title: id,
    groupId: "release-qa",
    shellPath: "powershell.exe",
    shellArgs: ["-NoLogo", "-NoProfile"],
    cwd: root,
    profile: "code-assistant",
    detached: false,
    status: "running",
  }));
  const saved = {
    groups: [{ id: "release-qa", name: "Release QA", cwd: root }],
    tabs: owned,
    activeGroupId: "release-qa",
    activeTabId: owned[0].id,
    savedLayouts: {},
    layout: {
      columnCount: 2,
      columnRatios: [3, 2],
      cells: owned.map((tab, col) => ({
        id: tab.id + "-cell",
        tabId: tab.id,
        col,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
      })),
    },
  };
  try {
    let app = await launch();
    await app.evaluate(
      async ({ saved, root }) => {
        const call = window.__TAURI_INTERNALS__.invoke;
        const sql = (query, values = []) =>
          call("plugin:sql|execute", { db: "sqlite:panel.db", query, values });
        await sql("DELETE FROM calendar_events");
        await sql("DELETE FROM projects");
        await sql("INSERT INTO projects (id,name,root_path) VALUES (?,?,?)", [
          "release-qa",
          "Release QA",
          root,
        ]);
        await sql(
          "INSERT INTO terminal_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
          [
            "cairngorm-terminal-workspace-v1",
            JSON.stringify({ version: 1, state: saved }),
            Date.now(),
          ],
        );
        localStorage.setItem("active-project-id", "release-qa");
        localStorage.setItem("show-splash", "false");
        localStorage.setItem("sidebar-side", "left");
      },
      { saved, root },
    );
    await stop();
    app = await launch();
    await expect(app.locator("[data-pane-id]")).toHaveCount(2);
    assert.deepEqual(
      (await snapshot(app)).tabs.map((tab) => tab.id),
      owned.map((tab) => tab.id),
      "Release fixture identities restored",
    );
    const sibling = "release-unrelated";
    await invoke(app, "pty_ensure", {
      sessionId: sibling,
      shell: "powershell.exe",
      args: ["-NoLogo", "-NoProfile"],
      env: [],
      cwd: root,
    });
    async function detach() {
      await app.locator("[data-pane-id]").first().hover();
      await app
        .getByTitle("Detach the split view to a window (keeps the grid)", { exact: true })
        .first()
        .click();
      await expect
        .poll(() =>
          browser
            .contexts()[0]
            .pages()
            .some((page) => page.url().includes("detached=release-first")),
        )
        .toBe(true);
      const page = browser
        .contexts()[0]
        .pages()
        .find((page) => page.url().includes("detached=release-first"));
      await page.getByRole("button", { name: "Reattach", exact: true }).waitFor();
      return page;
    }
    let detached = await detach();
    await detached.getByRole("button", { name: /^(Split|Add to split)$/ }).click();
    await detached.getByRole("menuitem", { name: "New terminal", exact: true }).click();
    await expect.poll(async () => (await snapshot(app)).tabs.length).toBe(3);
    const before = await snapshot(app);
    const second = before.tabs.find((tab) => !owned.some((original) => original.id === tab.id));
    await detached.locator(`[data-pane-id="${second.id}"] .xterm`).click();
    await detached.keyboard.type("Write-Output ('BUNDLE_'+'MEMBER_READY')");
    await detached.keyboard.press("Enter");
    await expect
      .poll(async () => {
        const replay = await invoke(app, "pty_replay", { sessionId: second.sessionId });
        return atob(replay?.data ?? "");
      })
      .toContain("BUNDLE_MEMBER_READY");
    const detachedLayout = before.detachedLayouts["detached-release-first"].layout;
    await expect(detached.locator("[data-pane-id]:visible")).toHaveCount(3);
    await expect(
      detached.getByRole("status", { name: "Loading terminal", exact: true }),
    ).toHaveCount(0);
    await detached.screenshot({
      path: "logs/e2e/release-detached-three-members.png",
      animations: "disabled",
    });
    await detached.getByRole("button", { name: "Reattach", exact: true }).evaluate((button) => {
      setTimeout(() => button.click(), 0);
    });
    await expect.poll(() => detached.isClosed()).toBe(true);
    await expect
      .poll(async () => (await snapshot(app)).tabs.every((tab) => !tab.detached))
      .toBe(true);
    await expect.poll(async () => (await snapshot(app)).layout?.cells.length).toBe(3);
    const attachedLayout = (await snapshot(app)).layout;
    assert.equal(attachedLayout.columnCount, detachedLayout.columnCount);
    assert.deepEqual(attachedLayout.columnRatios, detachedLayout.columnRatios);
    assert.deepEqual(
      attachedLayout.cells.map(({ id, tabId, col, row }) => ({ id, tabId, col, row })),
      detachedLayout.cells.map(({ id, tabId, col, row }) => ({ id, tabId, col, row })),
      "Packaged reattach keeps every cell anchored",
    );
    // Reattach intentionally fills a vacant grid slot; spans may grow, never shrink or overlap.
    for (const cell of attachedLayout.cells) {
      const prior = detachedLayout.cells.find((previous) => previous.id === cell.id);
      assert.ok(cell.colSpan >= prior.colSpan && cell.rowSpan >= prior.rowSpan);
      for (const other of attachedLayout.cells)
        if (cell !== other)
          assert.ok(
            !(
              cell.col < other.col + other.colSpan &&
              other.col < cell.col + cell.colSpan &&
              cell.row < other.row + other.rowSpan &&
              other.row < cell.row + cell.rowSpan
            ),
          );
    }
    for (const tab of before.tabs)
      assert.ok(
        await invoke(app, "pty_replay", { sessionId: tab.sessionId }),
        "Reattach keeps every PTY",
      );
    // Do not wait for pane startup: close must also drain pending attachments.
    detached = await detach();
    await invoke(detached, "plugin:window|close", { label: "detached-release-first" }).catch(
      () => {},
    );
    await expect.poll(() => detached.isClosed()).toBe(true);
    await expect.poll(async () => (await snapshot(app)).tabs.length).toBe(0);
    for (const tab of before.tabs) {
      await expect
        .poll(() => invoke(app, "pty_replay", { sessionId: tab.sessionId }), {
          message: "Close kills every owned PTY",
        })
        .toBeNull();
    }
    assert.ok(await invoke(app, "pty_replay", { sessionId: sibling }), "Unrelated PTY survives");
    await app.screenshot({ path: "logs/e2e/release-detached-after-close.png" });
    await stop();
    app = await launch();
    assert.equal(
      (await snapshot(app)).tabs.length,
      0,
      "Closed detached tabs do not resurrect on relaunch",
    );
    fs.writeFileSync(
      "logs/release-detached-packaged-evidence.json",
      JSON.stringify(
        {
          release: true,
          packagedFrontend: true,
          owned: 3,
          keyboardExecution: true,
          reattach: true,
          repeatedDetach: true,
          close: true,
          unrelatedSurvives: true,
          relaunch: true,
          layout: attachedLayout,
        },
        null,
        2,
      ),
    );
    await stop();
    console.log(
      "PASS: packaged release UI; three PTYs, real keyboard execution, detach/reattach/detach/close, layout and unrelated PTY preserved, no orphan tabs after relaunch",
    );
    return {
      release: true,
      ownedPtys: 3,
      reattach: true,
      close: true,
      unrelatedPtySurvives: true,
      noResurrection: true,
      rapidClose: true,
    };
  } finally {
    await qa.stop();
  }
});
