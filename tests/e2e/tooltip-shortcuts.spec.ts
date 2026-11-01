import { test, expect } from "./fixtures";
import type { Page, Locator } from "@playwright/test";

async function tip(app: Page, control: Locator, text: string) {
  await app.mouse.move(700, 600);
  await control.hover();
  const tooltip = app.getByRole("tooltip");
  await expect(tooltip).toHaveText(text);
  await expect
    .poll(async () => {
      const box = await tooltip.boundingBox();
      return !!box && box.x >= 8 && box.x + box.width <= app.viewportSize()!.width - 8;
    })
    .toBe(true);
}

async function keybindings(app: Page) {
  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Keybindings", exact: true }).click();
}

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("show-splash", "false");
  });
  await app.reload();
  await expect(app.getByTestId("sidebar")).toBeVisible();
});

test("brief hover descriptions show only real shortcuts and leave actions working", async ({
  app,
}) => {
  await tip(app, app.getByTestId("header-settings"), "Settings (Ctrl+,)");
  await tip(app, app.getByTestId("sidebar-files-toggle"), "Files (Ctrl+B)");
  await tip(app, app.getByTestId("mode-calendar"), "Calendar (Ctrl+Alt+2)");
  await tip(app, app.getByTestId("header-help"), "Help");
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  const bar = app.getByRole("tablist", { name: "Workspace tabs" });
  await tip(
    app,
    bar.getByRole("button", { name: "New terminal", exact: true }),
    "New terminal (Ctrl+Shift+T)",
  );
  const split = app.getByRole("button", { name: "Split", exact: true });
  await tip(app, split, "Split (Ctrl+\\)");
  await app.screenshot({ path: "logs/e2e/shortcut-split.png" });
  await app.getByTestId("header-settings").focus();
  await app.keyboard.press("Control+Backslash");
  await expect(app.locator("[data-pane-id]:visible")).toHaveCount(2);
  // Ctrl+\ now unsplits, not adds a pane; don't advertise it for another split.
  await tip(app, app.getByRole("button", { name: "Add to split", exact: true }), "Add to split");
  await tip(app, app.getByRole("button", { name: "Arrange split", exact: true }), "Arrange split");
  await app.screenshot({ path: "logs/e2e/shortcut-arrange.png" });
  const activeTab = bar.getByRole("tab", { selected: true }).locator("..");
  await tip(
    app,
    activeTab.getByRole("button", { name: "Close tab", exact: true }),
    "Close tab (Ctrl+Shift+W)",
  );
  const inactiveTab = bar.getByRole("tab", { selected: false }).locator("..");
  await tip(app, inactiveTab.getByRole("button", { name: "Close tab", exact: true }), "Close tab");
  await app.getByTestId("header-settings").focus();
  await app.keyboard.press("Control+Shift+Backslash");
  await expect(app.locator("[data-pane-id]:visible")).toHaveCount(3);
});

test("hover uses remapped, disabled and restored shortcuts without changing accessible labels", async ({
  app,
}) => {
  await keybindings(app);
  await app.getByRole("button", { name: "Edit Open settings shortcut", exact: true }).click();
  await app.keyboard.press("Control+Shift+k");
  await app.keyboard.press("Escape");
  await tip(app, app.getByTestId("header-settings"), "Settings (Ctrl+Shift+K)");
  await app.reload();
  await tip(app, app.getByTestId("header-settings"), "Settings (Ctrl+Shift+K)");
  await keybindings(app);
  await app.getByRole("button", { name: "Disable Open settings shortcut", exact: true }).click();
  await app.keyboard.press("Escape");
  await tip(app, app.getByTestId("header-settings"), "Settings");
  await keybindings(app);
  await app.getByRole("button", { name: "Restore all defaults", exact: true }).click();
  await app.keyboard.press("Escape");
  await tip(app, app.getByTestId("header-settings"), "Settings (Ctrl+,)");
  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "General", exact: true }).click();
  await tip(
    app,
    app.getByRole("button", { name: "Bigger", exact: true }),
    "Increase font size (Ctrl++)",
  );
  await app.getByRole("button", { name: "Bigger", exact: true }).click();
  await expect(app.getByTestId("settings-font-size")).toHaveText("15px");
});
