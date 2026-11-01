import { test, expect, SEED_INIT } from "./fixtures";

const dockSelector = '[data-testid="sidebar-dock"]';

async function bottom(app: import("@playwright/test").Page) {
  await app.evaluate(() => {
    localStorage.setItem("sidebar-side", "bottom");
    localStorage.setItem("show-splash", "false");
  });
  await app.reload();
  await expect(app.locator(dockSelector)).toBeVisible();
}

async function position(app: import("@playwright/test").Page, label: string) {
  // One navigation-position control for every layout: the title bar's.
  await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
  await app.getByRole("menuitemradio", { name: label, exact: true }).click();
}

test("fresh installations start with the bottom dock", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(SEED_INIT);
  await page.addInitScript(() => localStorage.setItem("show-splash", "false"));
  await page.goto("/");
  await expect(page.locator(dockSelector)).toHaveAttribute("data-side", "bottom");
  const box = (await page.locator(dockSelector).boundingBox())!;
  expect(box.width).toBe(1440);
  expect(box.y + box.height).toBe(900);
  expect(box.height).toBe(48);
  expect(
    await page.locator(dockSelector).evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
});

test("dock switches top/bottom, persists and returns to the vertical sidebar", async ({ app }) => {
  await bottom(app);
  await app.takeScreenshot("dock-bottom-empty");
  await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
  await app.getByRole("menuitemradio", { name: "Top", exact: true }).click();
  await expect(app.locator(dockSelector)).toHaveAttribute("data-side", "top");
  expect((await app.locator(dockSelector).boundingBox())!.y).toBe(38);
  await app.reload();
  await expect(app.locator(dockSelector)).toHaveAttribute("data-side", "top");
  await position(app, "Left");
  await expect(app.locator('[data-testid="sidebar"]')).toHaveAttribute("data-side", "left");
  await expect(app.locator(dockSelector)).toHaveCount(0);
  await app.locator('[data-testid="header-settings"]').click();
  await app.getByRole("radio", { name: "Bottom", exact: true }).click();
  await app.keyboard.press("Escape");
  await expect(app.locator(dockSelector)).toHaveAttribute("data-side", "bottom");
});

test("Files opens inward and stays mounted when changing orientation; Escape restores focus", async ({
  app,
}) => {
  await bottom(app);
  const files = app.locator(`${dockSelector} [data-testid="sidebar-files-toggle"]`);
  await files.click();
  const panel = app.locator('[data-testid="sidebar"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-testid="workspace-name"]')).toBeVisible();
  expect((await panel.boundingBox())!.y + (await panel.boundingBox())!.height).toBeLessThan(
    (await app.locator(dockSelector).boundingBox())!.y,
  );
  await panel
    .locator('[data-testid="workspace-name"]')
    .evaluate((el) => el.setAttribute("data-kept", "yes"));
  await app.takeScreenshot("dock-bottom-files");
  await position(app, "Top");
  await expect(panel.locator('[data-kept="yes"]')).toBeVisible();
  expect((await panel.boundingBox())!.y).toBeGreaterThan(86);
  await app.takeScreenshot("dock-top-files");
  await position(app, "Right");
  await expect(panel.locator('[data-kept="yes"]')).toBeVisible();
  await app.locator('[data-testid="header-settings"]').click();
  await app.getByRole("radio", { name: "Bottom", exact: true }).click();
  await app.keyboard.press("Escape");
  await expect(app.getByRole("dialog")).toBeHidden();
  await expect(panel.locator('[data-kept="yes"]')).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(files).toBeFocused();
  await files.click();
  await expect(panel.locator('[data-kept="yes"]')).toBeVisible();
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(panel).toBeHidden();
});

test("Git and Calendar toggle without duplicating terminal tabs", async ({ app }) => {
  await bottom(app);
  await app.locator(`${dockSelector} [data-testid="sidebar-git-toggle"]`).click();
  const panel = app.locator('[data-testid="sidebar"]');
  await expect(panel).toBeVisible();
  await expect(app.locator('[data-testid="dock-terminals"]')).toHaveCount(0);
  await app.takeScreenshot("dock-bottom-git");
  await app.locator(`${dockSelector} [data-testid="mode-calendar"]`).click();
  await expect(app.locator('[data-testid="calendar-view"]')).toBeVisible();
  await expect(panel).toContainText("Calendar");
  await app.locator(`${dockSelector} [data-testid="mode-calendar"]`).click();
  await expect(panel).toBeHidden();
  await expect(app.locator('[data-testid="terminal-empty"]')).toBeVisible();
});

test("project picker creates/switches projects; terminal actions remain available", async ({
  app,
}) => {
  await bottom(app);
  await app.locator('[data-testid="dock-project-picker"]').click();
  await app.evaluate(() => {
    (window as any).__E2E_PICK__ = "C:/code/alpha";
  });
  await app.locator('[role="menu"] [data-testid="legend-add-projects"]').click();
  await expect(app.locator('[data-testid="dock-project-picker"]')).toContainText("alpha");
  await app.keyboard.press("Escape");
  const terms = app.getByRole("tab");
  await expect(terms).toHaveCount(1);
  await app.getByRole("button", { name: "New terminal", exact: true }).click();
  await app
    .getByRole("menuitem")
    .filter({ hasText: /PowerShell|Default shell/i })
    .first()
    .click();
  await expect(terms).toHaveCount(2);
  await terms.first().click();
  await expect(terms.first()).toHaveAttribute("aria-selected", "true");
  await terms.first().click({ button: "right" });
  await app.getByRole("menuitem", { name: "Rename pane", exact: true }).click();
  const rename = app.getByRole("tablist").getByRole("textbox");
  await rename.fill("Build & tests");
  await rename.press("Enter");
  await expect(terms.first()).toContainText("Build & tests");
  await app.takeScreenshot("dock-bottom-terminals");
  await position(app, "Top");
  await expect(terms).toHaveCount(2);
  await expect(app.locator('[data-testid="dock-terminals"]')).toHaveCount(0);
  const dock = app.locator(dockSelector);
  await expect(dock.getByRole("tablist")).toHaveCount(1);
  await expect(app.locator(".workspace-tab-bar")).toHaveCount(1);
  const projectBox = (await dock.locator('[data-testid="dock-project-picker"]').boundingBox())!;
  const tabsBox = (await dock.getByRole("tablist").boundingBox())!;
  expect(tabsBox.y + tabsBox.height / 2).toBe(projectBox.y + projectBox.height / 2);
  await app.takeScreenshot("dock-top-tabs-primary");
  await dock.locator('[data-testid="mode-calendar"]').click();
  await expect(app.locator('[data-testid="calendar-view"]')).toBeVisible();
  await expect(terms.first()).toBeVisible();
  await terms.first().click();
  await expect(app.locator('[data-testid="calendar-view"]')).toBeHidden();
  await expect(terms.first()).toHaveAttribute("aria-selected", "true");
  await app.locator('[data-testid="dock-project-picker"]').click();
  await app
    .locator('[role="menu"] [data-testid^="project-box-"]')
    .filter({ hasText: "Home" })
    .click();
  await expect(app.locator('[data-testid="dock-project-picker"]')).toContainText("Home");
  await app.keyboard.press("Escape");
  await expect(terms).toHaveCount(0);
});

test("project appearance and removal dialogs work above the picker", async ({ app }) => {
  await app.addInitScript(() => {
    const api = (window as any).__TAURI_INTERNALS__;
    const original = api.invoke;
    api.invoke = (cmd: string, args: any) =>
      cmd === "plugin:sql|execute" && /(?:INTO|UPDATE|FROM)\s+projects\b/i.test(args?.query ?? "")
        ? Promise.resolve([1, 1])
        : original(cmd, args);
  });
  await bottom(app);
  const picker = app.locator('[data-testid="dock-project-picker"]');
  await picker.click();
  await app.evaluate(() => {
    (window as any).__E2E_PICK__ = "C:/code/alpha";
  });
  await app.locator('[role="menu"] [data-testid="legend-add-projects"]').click();
  await expect(picker).toContainText("alpha");
  await picker.click();
  const alpha = app
    .locator('[role="menu"] [data-testid^="project-box-"]')
    .filter({ hasText: "alpha" });
  await alpha.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Change Appearance…" }).click();
  const appearance = app.locator('[data-testid="background-dialog"]');
  await appearance.getByRole("button", { name: "Ruby", exact: true }).click();
  await expect(appearance.getByRole("button", { name: "Ruby", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await app.keyboard.press("Escape");
  await expect(appearance).toHaveCount(0);
  await expect(alpha).toBeVisible();
  await alpha.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Remove Project…" }).click();
  await app
    .getByRole("dialog", { name: "Remove project" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(alpha).toBeVisible();
  await alpha.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Remove Project…" }).click();
  await app
    .getByRole("dialog", { name: "Remove project" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(picker).toContainText("Home");
});

test("dock modules do not change the saved vertical collapse preference", async ({ app }) => {
  await app.locator('[data-testid="sidebar-collapse"]').click();
  await app.locator('[data-testid="header-settings"]').click();
  await app.getByRole("radio", { name: "Bottom", exact: true }).click();
  await app.keyboard.press("Escape");
  await app.locator(`${dockSelector} [data-testid="sidebar-files-toggle"]`).click();
  await app.locator(`${dockSelector} [data-testid="sidebar-files-toggle"]`).click();
  await app.evaluate(() =>
    window.dispatchEvent(new CustomEvent("app-open-module", { detail: "git" })),
  );
  await position(app, "Left");
  await expect(app.locator('[data-testid="sidebar-collapsed"]')).toBeVisible();
  expect(await app.evaluate(() => localStorage.getItem("sidebar-collapsed"))).toBe("true");
});

test("portrait windows preserve top/bottom docks and inward panels without duplicate terminal tabs", async ({
  app,
}) => {
  await bottom(app);
  for (const edge of ["bottom", "top"] as const) {
    if (edge === "top") await position(app, "Top");
    for (const width of [390, 320]) {
      await app.setViewportSize({ width, height: 720 });
      const dock = app.locator(dockSelector);
      await expect(dock).toHaveAttribute("data-side", edge);
      await expect(app.locator('[data-testid="sidebar-collapsed"]')).toHaveCount(0);
      await expect(app.locator('[data-testid="header-sidebar-side-toggle"]')).toBeInViewport();
      await expect(dock.getByRole("tablist")).toBeVisible();
      expect(await app.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const box = (await dock.boundingBox())!;
      expect(edge === "top" ? box.y : box.y + box.height).toBe(edge === "top" ? 38 : 720);
      await dock.locator('[data-testid="sidebar-files-toggle"]').click();
      await expect(app.locator('[data-testid="sidebar"]')).toBeVisible();
      await app.takeScreenshot(`dock-portrait-${edge}-${width}`);
      await app.keyboard.press("Escape");
      await expect(app.locator('[data-testid="sidebar"]')).toBeHidden();
      await expect(app.locator('[data-testid="dock-terminals"]')).toHaveCount(0);
      await expect(app.locator('[data-testid="dock-new-terminal"]')).toHaveCount(0);
    }
    await app.setViewportSize({ width: 1440, height: 900 });
    await expect(app.locator(dockSelector)).toHaveAttribute("data-side", edge);
  }
});
