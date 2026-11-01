import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/** Projects live in the sidebar's picker (dock style); it closes when the project changes. */
async function openProjects(app: Page) {
  const grid = app.locator('[data-testid="projects-grid"]');
  if (!(await grid.isVisible())) {
    await app.getByTestId("sidebar-project-picker").click();
  }
  await expect(grid).toBeVisible();
}

test("project names edit inline from tiles and the header without a dialog", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const tile = app.locator('[data-testid^="project-box-"]').first();
  const hero = app.locator('[data-testid="active-project-card"]');
  const editor = app.getByRole("textbox", { name: "Project name", exact: true });
  const name = app.locator('[data-testid="active-project-name"]');

  await openProjects(app);
  await tile.dblclick();
  await expect(editor).toBeFocused();
  // No modal: the project picker itself is a (non-modal) dialog popover.
  await expect(app.locator('[role="dialog"]:not([data-popover])')).toHaveCount(0);
  await expect(editor).toHaveValue("Home");
  await expect(editor).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(editor).toHaveCSS("border-top-width", "0px");
  await expect(editor).toHaveCSS("border-left-width", "0px");
  await expect(editor).toHaveCSS("border-right-width", "0px");
  await expect(editor).toHaveCSS("border-bottom-width", "1px");
  expect(
    await editor.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!),
  ).toBe(4);
  await app
    .locator('[data-testid="sidebar"]')
    .screenshot({ path: "logs/e2e/project-rename-inline.png" });
  await editor.fill("  My project  ");
  await editor.press("Enter");
  await expect(name).toHaveText("My project");
  await expect(tile).toContainText("My project");

  await tile.focus();
  await tile.press("F2");
  await editor.fill("Cancelled");
  await editor.press("Escape");
  await expect(name).toHaveText("My project");
  await tile.dblclick();
  await editor.fill("   ");
  await editor.press("Enter");
  await expect(name).toHaveText("My project");

  await tile.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await expect(editor).toBeFocused();
  await editor.fill("Tile blur");
  // Clicking outside closes the picker; the edit in progress still commits.
  await app.mouse.click(1000, 600);
  await expect(app.locator('[data-testid="projects-grid"]')).toBeHidden();
  await expect(name).toHaveText("Tile blur");

  await hero.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await expect(hero.getByRole("textbox", { name: "Project name" })).toBeFocused();
  // No modal: the project picker itself is a (non-modal) dialog popover.
  await expect(app.locator('[role="dialog"]:not([data-popover])')).toHaveCount(0);
  await app
    .locator('[data-testid="sidebar"]')
    .screenshot({ path: "logs/e2e/project-rename-hero.png" });
  await editor.fill("Hero name");
  await editor.press("Enter");
  await expect(name).toHaveText("Hero name");
  await openProjects(app);
  await expect(tile).toContainText("Hero name");
  await app.keyboard.press("Escape");

  // The modules belong to the header: their right-click carries the same menu.
  const modules = app.locator('[data-testid="mode-calendar"]');
  await modules.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await expect(editor).toBeFocused();
  await editor.fill("From modules");
  await editor.press("Enter");
  await expect(name).toHaveText("From modules");
});
