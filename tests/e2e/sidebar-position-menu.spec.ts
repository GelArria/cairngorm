import { test, expect } from "./fixtures";

test("position previews select all four edges, cancel safely and persist", async ({ app }) => {
  for (const [edge, label] of [
    ["right", "Right"],
    ["top", "Top"],
    ["bottom", "Bottom"],
    ["left", "Left"],
  ]) {
    const before = await app.evaluate(() => localStorage.getItem("sidebar-side"));
    await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
    const menu = app.locator('[data-testid="sidebar-position-menu"]');
    await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
    await menu.getByRole("menuitemradio", { name: label, exact: true }).hover();
    expect(await app.evaluate(() => localStorage.getItem("sidebar-side"))).toBe(before);
    if (edge === "right") await app.takeScreenshot("sidebar-position-preview");
    await app.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    expect(await app.evaluate(() => localStorage.getItem("sidebar-side"))).toBe(before);
    await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
    const option = menu.getByRole("menuitemradio", { name: label, exact: true });
    await option.focus();
    await app.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    const surface = app.locator(
      edge === "top" || edge === "bottom"
        ? '[data-testid="sidebar-dock"]'
        : '[data-testid="sidebar"]',
    );
    await expect(surface).toHaveAttribute("data-side", edge);
    expect(await app.evaluate(() => localStorage.getItem("sidebar-side"))).toBe(edge);
    await app.reload();
    await expect(surface).toHaveAttribute("data-side", edge);
  }
});
