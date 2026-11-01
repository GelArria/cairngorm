import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { SEED_INIT } from "./fixtures";
import fs from "node:fs";

const BOOT =
  SEED_INIT +
  `
  localStorage.setItem("show-splash", "false");
  localStorage.setItem("sidebar-side", "left");
  const invoke = window.__TAURI_INTERNALS__.invoke;
  let reads = 0;
  window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
    if (cmd === "plugin:sql|select" && /FROM\\s+projects/i.test(args.query)) {
      reads++;
      if (localStorage.getItem("restore-sql-outage") === "yes") return Promise.reject("database unavailable");
      if (reads === 1) return Promise.reject("database temporarily locked");
      return Promise.resolve([
        { id: "one", name: "Project One", root_path: "C:/one", created_at: "2026-01-01 00:00:00" },
        { id: "two", name: "Project Two", root_path: "C:/two", created_at: "2026-01-02 00:00:00" },
      ]);
    }
    if (cmd === "plugin:sql|execute") return Promise.resolve({ rowsAffected: 1, lastInsertId: 0 });
    if (cmd.startsWith("pty_")) return Promise.resolve(cmd === "pty_replay" ? btoa("PowerShell - workspace restored\\r\\n") : undefined);
    if (cmd === "detect_home") return Promise.resolve("C:/home");
    return invoke(cmd, args);
  };
`;

const tabs = ["one", "two"].flatMap((groupId) =>
  [1, 2].map((n) => ({
    id: `${groupId}-${n}`,
    sessionId: `session-${groupId}-${n}`,
    title: `PowerShell ${n}`,
    groupId,
    cwd: `C:/${groupId}`,
    shellPath: "powershell.exe",
    profile: "code-assistant",
    detached: false,
    status: "running",
  })),
);
const grid = (group: string) => ({
  columnCount: 3,
  columnRatios: [3, 2, 1],
  cells: [
    { id: `${group}-a`, tabId: `${group}-1`, col: 0, row: 0, colSpan: 3, rowSpan: 2 },
    { id: `${group}-b`, tabId: `${group}-2`, col: 0, row: 2, colSpan: 3, rowSpan: 1 },
  ],
});
const saved = {
  groups: [
    { id: "one", name: "Project One", cwd: "C:/one" },
    { id: "two", name: "Project Two", cwd: "C:/two" },
  ],
  tabs,
  activeGroupId: "two",
  activeTabId: "two-2",
  layout: grid("two"),
  savedLayouts: { one: grid("one") },
};

const snapshot = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("cairngorm-terminal-workspace-v1")!).state);
async function open(context: BrowserContext) {
  await context.addInitScript(BOOT);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("[data-pane-id]")).toHaveCount(2);
  await expect(page.getByTestId("active-project-name")).toBeVisible();
  return page;
}

test("fresh windows restore both projects and stretched grids despite transient and persistent SQL failures", async ({
  browser,
  baseURL,
}) => {
  fs.mkdirSync("logs/e2e", { recursive: true });
  let context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  try {
    await context.addInitScript((state) => {
      if (!localStorage.getItem("cairngorm-terminal-workspace-v1")) {
        localStorage.setItem(
          "cairngorm-terminal-workspace-v1",
          JSON.stringify({ version: 1, state }),
        );
        localStorage.setItem("active-project-id", "two");
      }
    }, saved);
    let page = await open(context);
    expect(await snapshot(page)).toMatchObject(saved);
    await page.screenshot({ path: "logs/e2e/projects-layout-before-close.png" });
    await page.evaluate(() => localStorage.setItem("restore-sql-outage", "yes"));
    const persisted = await context.storageState();
    await context.close();
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
      storageState: persisted,
    });
    page = await open(context);
    expect(await snapshot(page)).toMatchObject(saved);
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest("[data-pane-id]")?.getAttribute("data-pane-id"),
        ),
      )
      .toBe("two-2");
    await page.screenshot({ path: "logs/e2e/projects-layout-after-close.png" });
    // Both projects are restored (checked after focus: the picker takes it).
    await page.getByTestId("sidebar-project-picker").click();
    await expect(page.getByTestId("project-box-two")).toBeVisible();
    await page.getByTestId("project-box-one").click();
    await expect.poll(async () => (await snapshot(page)).activeGroupId).toBe("one");
    expect((await snapshot(page)).layout).toEqual({ ...saved.savedLayouts.one, color: "rose" });
    await expect(page.locator("[data-pane-id]")).toHaveCount(2);
    await page.screenshot({ path: "logs/e2e/projects-layout-other-project.png" });
  } finally {
    await context.close();
  }
});
