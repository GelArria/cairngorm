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

test("project menu colors update the tile, header and collapsed rail", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await openProjects(app);
  const tile = app.locator('[data-testid^="project-box-"]').first();
  const gem = tile.locator(".project-gem");
  const original = await gem.evaluate((el) => (el as SVGElement).style.getPropertyValue("--gem"));
  await tile.click({ button: "right" });
  await app.getByRole("menuitemradio", { name: "Clay", exact: true }).click();
  await openProjects(app);
  await expect(gem).toHaveCSS("--gem", "#cf8a6d");
  await app.keyboard.press("Escape");
  await expect(app.locator('[data-testid="active-project-card"] .project-gem')).toHaveCSS(
    "--gem",
    "#cf8a6d",
  );
  await app.takeScreenshot("project-color-clay");
  await app.locator('[data-testid="sidebar-collapse"]').click();
  await expect(app.locator('[data-testid^="rail-project-"] .project-gem').first()).toHaveCSS(
    "--gem",
    "#cf8a6d",
  );
  await app.locator('[data-testid="sidebar-expand"]').click();
  await openProjects(app);
  await tile.click({ button: "right" });
  await expect(app.getByRole("menuitemradio", { name: "Clay", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await app.getByRole("menuitemradio", { name: "No colour" }).click();
  await openProjects(app);
  await expect(gem).toHaveCSS("--gem", original);
});
