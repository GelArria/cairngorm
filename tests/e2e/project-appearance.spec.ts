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

test("appearance dialog changes stones without a redundant color selector", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const tile = app.locator('[data-testid^="project-box-"]').first();
  const hero = app.locator('[data-testid="active-project-card"]');
  const gem = hero.locator(".project-gem");
  await openProjects(app);
  await tile.click({ button: "right" });
  await app.getByRole("menuitemradio", { name: "Clay", exact: true }).click();
  await app.keyboard.press("Escape");
  await hero.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Change Appearance…", exact: true }).click();
  const dialog = app.locator('[data-testid="background-dialog"]');
  await dialog.getByRole("button", { name: "Ruby", exact: true }).click();
  await expect(gem).toHaveCSS("--gem", "#ff8a9a");
  await expect(dialog.getByRole("group", { name: "Gem color" })).toHaveCount(0);
  await expect(gem).toHaveCSS("--gem", "#ff8a9a");
  await expect(hero.locator(".project-gem")).toHaveCSS("--gem", "#ff8a9a");
  await dialog.getByRole("button", { name: "Plain", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Plain", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.getByRole("button", { name: "Emerald cut", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Emerald cut", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await app.takeScreenshot("project-appearance-dialog");
  await app.keyboard.press("Escape");
  await openProjects(app);
  await tile.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Change Appearance…", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Emerald cut", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Stone color", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Oval cut", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("added stones, cuts and label colors apply to the project gem", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const hero = app.locator('[data-testid="active-project-card"]');
  const gem = hero.locator(".project-gem");
  await hero.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Change Appearance…", exact: true }).click();
  const dialog = app.locator('[data-testid="background-dialog"]');
  await dialog.getByRole("button", { name: "Tanzanite", exact: true }).click();
  await expect(gem).toHaveCSS("--gem", "#8e8cff");
  for (const cut of ["Shield", "Half Moon", "Radiant", "Asscher"]) {
    const button = dialog.getByRole("button", { name: `${cut} cut`, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await app.takeScreenshot("project-appearance-more-options");
  await dialog.screenshot({
    path: "logs/e2e/project-appearance-more-options-zoom.png",
    scale: "device",
  });
  await app.keyboard.press("Escape");
  await openProjects(app);
  await app.locator('[data-testid^="project-box-"]').first().click({ button: "right" });
  await expect(app.getByRole("menuitemradio")).toHaveCount(13);
  await app.waitForTimeout(250); // let the menu's fade-in finish before capturing
  await app.takeScreenshot("project-appearance-color-menu");
  await app.getByRole("menuitemradio", { name: "Orchid", exact: true }).click();
  await expect(gem).toHaveCSS("--gem", "#c886bf");
});
