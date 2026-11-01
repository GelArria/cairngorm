import { test, expect } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

const pose = (gem: Locator) => gem.evaluate((svg) => svg.innerHTML);
async function turns(gem: Locator) {
  await expect(gem.locator("line").first()).toBeAttached();
  const before = await pose(gem);
  await expect.poll(() => pose(gem), { timeout: 3000 }).not.toBe(before);
}
async function still(gem: Locator) {
  const before = await pose(gem);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(await pose(gem)).toBe(before);
}

/** Projects live in the sidebar's picker (dock style); it closes when the project changes. */
async function openProjects(app: Page) {
  const grid = app.locator('[data-testid="projects-grid"]');
  if (!(await grid.isVisible())) {
    await app.getByTestId("sidebar-project-picker").click();
  }
  await expect(grid).toBeVisible();
}

const selectedTileGem = (app: Page) =>
  app.locator('[data-testid^="project-box-"][aria-current="true"] .project-gem');
// The header's gem turns while the sidebar is open; collapsed, the rail's gem does.
const headerGem = (app: Page) => app.locator('[data-testid="active-project"] .project-gem');

// Geometry must change, not just a CSS class or "no console errors".
test("selected gems turn on every startup without needing a mouse enter", async ({ app }) => {
  await app.emulateMedia({ reducedMotion: "no-preference" });
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.mouse.move(1000, 750);
  for (let n = 0; n < 10; n++) {
    await app.reload();
    await turns(headerGem(app));
    await openProjects(app);
    await turns(selectedTileGem(app));
  }
});

test("live motion preference, sidebar restore, hover and keyboard focus recover", async ({
  app,
}) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.emulateMedia({ reducedMotion: "reduce" });
  await app.reload();
  await openProjects(app);
  const tile = selectedTileGem(app);
  await still(tile);
  await app.emulateMedia({ reducedMotion: "no-preference" });
  await turns(tile);
  await app.keyboard.press("Escape");
  await app.locator('[data-testid="sidebar-collapse"]').click();
  await turns(app.locator('[data-testid^="rail-project-"][aria-current="true"] .project-gem'));
  await app.locator('[data-testid="sidebar-expand"]').click();
  await openProjects(app);
  await turns(tile);
  await app.emulateMedia({ reducedMotion: "reduce" });
  await still(tile);
  await app.emulateMedia({ reducedMotion: "no-preference" });
  await turns(tile);

  // Home becomes inactive; its hover and keyboard states must still animate.
  await app.evaluate(() => {
    (window as any).__E2E_PICK__ = "C:/code/rotation-check";
  });
  await app.locator('[data-testid="legend-add-projects"]').click();
  await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("rotation-check");
  await openProjects(app);
  const home = app.locator('[data-testid^="project-box-"]').filter({ hasText: "Home" });
  const gem = home.locator(".project-gem");
  // The opened picker may focus a tile (focused tiles turn): start from no focus or hover.
  await app.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await app.mouse.move(1000, 750);
  await still(gem);
  await home.hover();
  await turns(gem);
  await app.mouse.move(1000, 750);
  await home.focus();
  await turns(gem);
  await app.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await still(gem);
  await app.screenshot({ path: "logs/e2e/gem-rotation-picker.png" });
});

test("explicit unfreeze overrides reduced motion, persists, and can return to system defaults", async ({
  app,
}) => {
  await app.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const card = app.locator('[data-testid="active-project-card"]');
  const rail = app.locator('[data-testid^="rail-project-"][aria-current="true"] .project-gem');
  await openProjects(app);
  await still(selectedTileGem(app));
  await app.keyboard.press("Escape");
  await card.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Unfreeze 3D Rotation" }).click();
  await openProjects(app);
  await turns(selectedTileGem(app));
  await app.reload();
  await openProjects(app);
  await turns(selectedTileGem(app));
  await app.keyboard.press("Escape");
  await card.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Use System Motion Setting" }).click();
  await app.locator('[data-testid="sidebar-collapse"]').click();
  await still(rail);
  await app.emulateMedia({ reducedMotion: "no-preference" });
  await turns(rail);
});

test("selected collapsed gem keeps rotating through repeated collapse/expand", async ({ app }) => {
  await app.emulateMedia({ reducedMotion: "no-preference" });
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  for (let n = 0; n < 5; n++) {
    await app.locator('[data-testid="sidebar-collapse"]').click();
    await turns(app.locator('[data-testid^="rail-project-"][aria-current="true"] .project-gem'));
    await app.locator('[data-testid="sidebar-expand"]').click();
    await turns(headerGem(app));
  }
  await app
    .locator('[data-testid="sidebar"]')
    .screenshot({ path: "logs/e2e/gem-fixed-expanded.png" });
  await app.locator('[data-testid="sidebar-collapse"]').click();
  await app
    .locator('[data-testid="sidebar-collapsed"]')
    .screenshot({ path: "logs/e2e/gem-fixed-collapsed.png" });
});

test("project header right-click menu: edit and freeze toggles — reversible and persisted", async ({
  app,
}) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const card = app.locator('[data-testid="active-project-card"]');
  const open = async (name: string) => {
    await card.click({ button: "right" });
    await app.getByRole("menuitem", { name }).click();
  };
  await expect(card).toBeVisible();

  // The menu carries the project's edit actions
  await card.click({ button: "right" });
  await expect(app.getByRole("menuitem", { name: "Rename…" })).toBeVisible();
  await expect(app.getByRole("menuitem", { name: "Change Folder…" })).toBeVisible();
  await app.takeScreenshot("hero-context-menu");

  // Freeze — survives reload, unfreezes from the same menu
  await app.getByRole("menuitem", { name: "Freeze 3D Rotation" }).click();
  await openProjects(app);
  await still(selectedTileGem(app));
  await app.reload();
  await expect(card).toBeVisible();
  await openProjects(app);
  await still(selectedTileGem(app)); // frozen persisted
  await app.keyboard.press("Escape");
  await open("Unfreeze 3D Rotation");
  await openProjects(app);
  await turns(selectedTileGem(app));
  await app.keyboard.press("Escape");

  // Edit — rename + customize gem, both from the header
  await open("Rename…");
  const name = app.getByRole("textbox", { name: "Project name" });
  await name.fill("Renamed Home");
  await name.press("Enter");
  await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("Renamed Home");
  await open("Change Appearance…");
  await expect(app.locator('[data-testid="background-dialog"]')).toBeVisible();
  await app.keyboard.press("Escape");
  await app.waitForTimeout(400);
  await app.takeScreenshot("hero-menu-result");
});
