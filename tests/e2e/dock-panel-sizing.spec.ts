import { test, expect } from "./fixtures";

type Page = import("@playwright/test").Page;

async function openDockPanel(app: Page, toggle: string) {
  const dock = app.getByTestId("sidebar-dock");
  await dock.getByTestId(toggle).click();
  const panel = app.locator("#sidebar-dock-panel");
  await expect(panel).toBeVisible();
  return panel;
}

const box = async (locator: import("@playwright/test").Locator) => (await locator.boundingBox())!;

test("dock panels size to their module and share one content inset", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
  await app.getByRole("menuitemradio", { name: "Top", exact: true }).click();

  const files = await openDockPanel(app, "sidebar-files-toggle");
  await files.screenshot({ path: "logs/e2e/dock-panel-files.png" });
  const filesBox = await box(files);

  const git = await openDockPanel(app, "sidebar-git-toggle");
  await expect(git.getByTestId("git-file-row").first()).toBeVisible();
  await git.screenshot({ path: "logs/e2e/dock-panel-git.png" });
  const gitBox = await box(git);
  // The change list keeps real room under the commit box instead of a clipped sliver.
  expect((await box(git.locator("#git-view"))).height).toBeGreaterThanOrEqual(180);
  const inset = async (selector: string) =>
    (await box(git.locator(selector).first())).x - gitBox.x - 1; // minus the 1px panel border
  expect(await inset('[data-testid="git-commit-box"]')).toBe(12);
  expect(await inset('[role="tablist"][aria-label="Git views"]')).toBe(12);

  await app.getByTestId("sidebar-dock").getByTestId("mode-calendar").click();
  const agenda = app.locator("#sidebar-dock-panel");
  const list = agenda.getByTestId("calendar-view");
  await expect(list).toBeVisible();
  await list.getByRole("radio", { name: "Calendar events" }).click();
  await agenda.screenshot({ path: "logs/e2e/dock-panel-agenda.png" });
  const agendaBox = await box(agenda);
  // The calendar fills the same bounded panel as Files, leaving the terminals visible.
  const listBox = await box(list);
  expect(agendaBox.y + agendaBox.height - (listBox.y + listBox.height)).toBeLessThanOrEqual(2);
  expect(agendaBox.height).toBeLessThan(gitBox.height);

  // An empty month keeps the grid and panel dimensions stable.
  await app.evaluate(() => {
    const api = (window as any).__TAURI_INTERNALS__;
    const original = api.invoke;
    api.invoke = (cmd: string, args: any) =>
      cmd === "plugin:sql|select" && String(args?.query).includes("FROM calendar_events")
        ? Promise.resolve([])
        : original(cmd, args);
  });
  await agenda.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(agenda.getByText("No events this month")).toBeVisible();
  await agenda.screenshot({ path: "logs/e2e/dock-panel-agenda-empty.png" });
  expect((await box(agenda)).height).toBe(agendaBox.height);
  expect(gitBox.height).toBeGreaterThan(filesBox.height - 1);
  expect(new Set([filesBox.width, gitBox.width, agendaBox.width]).size).toBe(1);
});
