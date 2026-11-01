import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { splitNew } from "./split-helpers";

const executable = process.env.CAIRNGORM_RESTORE_EXE;
test.skip(!executable, "Requires the isolated restore QA build, never the user's installed app");

const snapshot = (page: Page) =>
  page.evaluate(async () => {
    const rows = await (window as any).__TAURI_INTERNALS__.invoke("plugin:sql|select", {
      db: "sqlite:panel.db",
      query: "SELECT value FROM terminal_state WHERE key = ?",
      values: ["cairngorm-terminal-workspace-v1"],
    });
    return JSON.parse(
      rows[0]?.value ?? localStorage.getItem("cairngorm-terminal-workspace-v1") ?? "null",
    )?.state;
  });

test("native exit and relaunch preserve SQLite projects, terminal identities, focus and stretched layouts", async () => {
  expect(path.resolve(executable!)).toContain(
    path.join("logs", "build", "workspace-restore-native"),
  );
  const config = JSON.parse(fs.readFileSync("logs/build/workspace-restore-native.json", "utf8"));
  expect(config.identifier).toMatch(/^com\.panelnative\.restoreqa\d+$/);
  const folders = ["one", "two"].map((name) => path.resolve(`logs/e2e/native-${name}`));
  folders.forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  const projects = folders.map((rootPath, i) => ({
    id: ["one", "two"][i],
    name: `Project ${i + 1}`,
    rootPath,
  }));
  const grid = (group: string) => ({
    columnCount: 3,
    columnRatios: [3, 2, 1],
    cells: [
      { id: `${group}-a`, tabId: `${group}-1`, col: 0, row: 0, colSpan: 3, rowSpan: 2 },
      { id: `${group}-b`, tabId: `${group}-2`, col: 0, row: 2, colSpan: 3, rowSpan: 1 },
    ],
  });
  const saved = {
    groups: projects.map((p) => ({ id: p.id, name: p.name, cwd: p.rootPath })),
    tabs: projects.flatMap((p) =>
      [1, 2].map((n) => ({
        id: `${p.id}-${n}`,
        groupId: p.id,
        sessionId: `native-${p.id}-${n}`,
        title: `PowerShell ${n}`,
        shellPath: "powershell.exe",
        shellArgs: ["-NoLogo", "-NoProfile"],
        cwd: p.rootPath,
        profile: "code-assistant",
        status: "running",
        detached: false,
      })),
    ),
    activeGroupId: "two",
    activeTabId: "two-2",
    layout: grid("two"),
    savedLayouts: { one: grid("one") },
  };
  let child: ChildProcess | undefined;
  let exited: Promise<number | null> | undefined;
  let browser: Browser | undefined;
  async function launch() {
    child = spawn(executable!, [], { cwd: path.dirname(executable!), stdio: "ignore" });
    exited = new Promise((resolve) => child!.once("exit", resolve));
    await expect(async () => {
      browser = await chromium.connectOverCDP("http://localhost:9224");
    }).toPass({ timeout: 30000 });
    const page = browser!.contexts()[0].pages()[0];
    await page.waitForURL(/tauri\.localhost/, { timeout: 30000 });
    await page.getByRole("button", { name: "New terminal", exact: true }).first().waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(async () => (await snapshot(page))?.activeGroupId ?? "g1", { timeout: 30000 })
      .not.toBe("g1");
    return page;
  }
  async function close(page: Page, bootstrapFixture = false) {
    await page
      .evaluate(
        (fixture) =>
          (window as any).__TAURI_INTERNALS__.invoke(
            fixture ? "plugin:window|destroy" : "plugin:window|close",
            { label: "main" },
          ),
        bootstrapFixture,
      )
      .catch(() => {});
    await expect.poll(() => child!.exitCode, { timeout: 30000 }).not.toBeNull();
    await exited;
    await browser!.close().catch(() => {});
    browser = undefined;
  }
  try {
    let page = await launch();
    await page.evaluate(
      async ({ projects, saved }) => {
        const invoke = (window as any).__TAURI_INTERNALS__.invoke;
        const execute = (query: string, values: unknown[] = []) =>
          invoke("plugin:sql|execute", { db: "sqlite:panel.db", query, values });
        await execute("DELETE FROM calendar_events");
        await execute("DELETE FROM projects");
        for (const p of projects)
          await execute("INSERT INTO projects (id,name,root_path) VALUES (?,?,?)", [
            p.id,
            p.name,
            p.rootPath,
          ]);
        localStorage.setItem("show-splash", "false");
        localStorage.setItem("sidebar-side", "left");
        localStorage.setItem("active-project-id", "two");
        // Seed only the first window; subsequent close/relaunch uses the production flush guard.
        await execute(
          "INSERT INTO terminal_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
          [
            "cairngorm-terminal-workspace-v1",
            JSON.stringify({ version: 1, state: saved }),
            Date.now(),
          ],
        );
      },
      { projects, saved },
    );
    await close(page, true);
    page = await launch();
    await expect(page.locator("[data-pane-id]")).toHaveCount(2);
    expect(await snapshot(page)).toMatchObject(saved);
    await page.getByTestId("project-box-one").click();
    await expect.poll(async () => (await snapshot(page)).activeGroupId).toBe("one");
    expect((await snapshot(page)).layout).toEqual(saved.savedLayouts.one);
    await page.getByTestId("project-box-two").click();
    await expect.poll(async () => (await snapshot(page)).activeGroupId).toBe("two");
    await splitNew(page);
    await expect(page.locator("[data-pane-id]")).toHaveCount(3);
    await expect.poll(async () => (await snapshot(page)).tabs.length).toBe(5);
    const before = await snapshot(page);
    await page.evaluate(async () => {
      await (window as any).__TAURI_INTERNALS__.invoke("plugin:sql|execute", {
        db: "sqlite:panel.db",
        query:
          "INSERT INTO terminal_state (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        values: ["native-close-guard-qa", "before", Date.now()],
      });
      const set = localStorage.setItem.bind(localStorage);
      window.addEventListener(
        "terminal-persist-flush",
        () => {
          const request = (window as any).__TAURI_INTERNALS__.invoke("plugin:sql|execute", {
            db: "sqlite:panel.db",
            query: "UPDATE terminal_state SET value=? WHERE key=?",
            values: ["flushed-at-close", "native-close-guard-qa"],
          });
          request.then(() => set("native-close-guard-qa-acked", "true"));
        },
        { once: true },
      );
    });
    await page.screenshot({ path: "logs/e2e/native-workspace-before-exit.png" });
    await close(page);
    page = await launch();
    await expect(page.getByTestId("project-box-one")).toBeVisible();
    await expect(page.getByTestId("project-box-two")).toBeVisible();
    await expect(page.locator("[data-pane-id]")).toHaveCount(3);
    const after = await snapshot(page);
    const flushProof = await page.evaluate(() =>
      (window as any).__TAURI_INTERNALS__.invoke("plugin:sql|select", {
        db: "sqlite:panel.db",
        query: "SELECT value FROM terminal_state WHERE key=?",
        values: ["native-close-guard-qa"],
      }),
    );
    expect(flushProof[0].value).toBe("flushed-at-close");
    expect(after.groups).toEqual(before.groups);
    expect(after.tabs.map((t: any) => [t.id, t.sessionId, t.groupId, t.cwd])).toEqual(
      before.tabs.map((t: any) => [t.id, t.sessionId, t.groupId, t.cwd]),
    );
    expect(after.layout).toEqual(before.layout);
    expect(after.savedLayouts).toEqual(before.savedLayouts);
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.activeGroupId).toBe(before.activeGroupId);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe(before.activeTabId);
    const replay = () =>
      page.evaluate(async () => {
        const result = await (window as any).__TAURI_INTERNALS__.invoke("pty_replay", {
          sessionId: "native-two-2",
        });
        return result?.data ? atob(result.data) : "";
      });
    await expect.poll(replay, { timeout: 15000 }).toContain("PS ");
    await page.screenshot({ path: "logs/e2e/native-workspace-after-relaunch.png" });
    await close(page);
  } finally {
    await browser?.close().catch(() => {});
    if (child?.exitCode === null) child.kill();
    await exited;
  }
});
