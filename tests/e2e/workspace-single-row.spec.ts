import { test, expect } from "./fixtures";

test("one workspace row keeps tabs and split actions usable in portrait at either edge", async ({
  app,
}) => {
  for (const label of ["Bottom", "Top"]) {
    await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
    await app.getByRole("menuitemradio", { name: label, exact: true }).click();
    const dock = app.locator('[data-testid="sidebar-dock"]');
    if (label === "Bottom") {
      for (let i = 0; i < 3; i++) {
        await dock.getByRole("button", { name: "New terminal", exact: true }).click();
        await app
          .getByRole("menuitem")
          .filter({ hasText: /PowerShell|Default shell/i })
          .first()
          .click();
      }
    }
    await app.setViewportSize({ width: 320, height: 720 });
    await expect(app.locator(".workspace-tab-bar")).toHaveCount(1);
    const tabs = dock.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await tabs.first().click();
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await tabs.last().click();
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await expect(tabs.last()).toBeInViewport();
    await expect(dock.getByRole("button", { name: "Choose project" })).toBeInViewport();
    await expect(dock.locator('[data-testid="sidebar-git-toggle"]')).toBeInViewport();
    expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await dock.getByRole("button", { name: /^(Split|Add to split)$/ }).click();
    await expect(app.getByRole("menuitem", { name: "New terminal", exact: true })).toBeVisible();
    await app.keyboard.press("Escape");
    await app.takeScreenshot(`workspace-single-row-${label.toLowerCase()}-320`);
    await app.setViewportSize({ width: 1440, height: 900 });
  }
});
