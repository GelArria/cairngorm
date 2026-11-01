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

// Projects replace terminal groups; the single sidebar moves left ⇄ right.
test.describe("Projects + sidebar side", () => {
  test("Home project, no conversation filter, no model in the footer", async ({ app }) => {
    await app.evaluate(() => localStorage.setItem("show-splash", "false"));
    await app.reload();
    const sidebar = app.locator('[data-testid="sidebar"]');
    await expect(sidebar.locator('[data-testid="projects-grid"]')).toBeHidden();
    await openProjects(app);
    await expect(sidebar.getByText("Projects", { exact: true })).toHaveCount(0); // no legend over the grid
    // The picker opens over the workspace, outside the sidebar element.
    await expect(app.locator('[data-testid^="project-box-"]')).toHaveCount(1);
    await expect(sidebar.getByText("Home", { exact: true }).first()).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(app.getByPlaceholder("Filter conversations")).toHaveCount(0);
    await expect(sidebar.getByText("gemma", { exact: false })).toHaveCount(0);
    // Project picker on top; the selected project's modules + terminals below
    await expect(sidebar.getByRole("button", { name: "Terminal", exact: true })).toHaveCount(0);
    await expect(sidebar.locator('[data-testid="active-project-name"]')).toHaveText("Home");
    await expect(sidebar.locator('[data-testid="mode-calendar"]')).toBeVisible();
    await expect(sidebar.locator('[data-testid="project-terminals"]')).toBeVisible();
    // No redundant Workspace button; an open module toggles back to terminals.
    await expect(sidebar.locator('[data-testid="mode-chat"]')).toHaveCount(0);
    await expect(
      sidebar
        .getByRole("group", { name: "Project modules" })
        .getByRole("button", { pressed: true }),
    ).toHaveCount(0);
    await sidebar.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect(sidebar.locator('[data-testid="sidebar-git-toggle"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sidebar.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect(sidebar.locator('[data-testid="project-terminals"]')).toBeVisible();
    await app.waitForTimeout(500);
    await app.takeScreenshot("projects-home");
  });

  test("New project from a folder becomes active and its files show in Files", async ({ app }) => {
    await app.evaluate(() => {
      (window as any).__E2E_PICK__ = "C:/code/alpha";
    });
    await openProjects(app);
    await app.locator('[data-testid="legend-add-projects"]').click();
    await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("alpha");
    await openProjects(app);
    const boxes = app.locator('[data-testid^="project-box-"]');
    await expect(boxes).toHaveCount(2);
    await expect(app.locator('[data-testid^="project-box-"][aria-current="true"]')).toContainText(
      "alpha",
    );
    await app.keyboard.press("Escape");
    // A shell is ready in the new project (the list shows only its terminals)
    await expect(
      app.locator('[data-testid="project-terminals"] [data-testid^="term-"]'),
    ).toHaveCount(1);
    await app.waitForTimeout(500);
    await app.takeScreenshot("projects-alpha");
    // Files panel follows the active project
    await app.locator('[data-testid="sidebar-files-toggle"]').click();
    await expect(app.locator('[data-testid="workspace-name"]')).toHaveText("alpha");
    await app.waitForTimeout(600);
    await app.takeScreenshot("projects-alpha-files");
    // Select Home: Files stays open and the tree follows the project
    await openProjects(app);
    await app.locator('[data-testid^="project-box-"]').filter({ hasText: "Home" }).click();
    await expect(app.locator('[data-testid="workspace-name"]')).toHaveText("TestUser");
    await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("Home");
    // Files again = back to Home's terminals
    await app.locator('[data-testid="sidebar-files-toggle"]').click();
    await expect(app.locator('[data-testid="project-terminals"]')).toBeVisible();
  });

  test("header button moves the whole sidebar to the right and back (persisted)", async ({
    app,
  }) => {
    const sidebar = app.locator('[data-testid="sidebar"]');
    const toggle = app.locator('[data-testid="header-sidebar-side-toggle"]');
    const width = app.viewportSize()!.width;
    expect((await sidebar.boundingBox())!.x).toBeLessThan(50);
    await toggle.click();
    await app.getByRole("menuitemradio", { name: "Right", exact: true }).click();
    await expect(sidebar).toHaveAttribute("data-side", "right");
    const box = (await sidebar.boundingBox())!;
    expect(box.x + box.width).toBeGreaterThan(width - 10);
    await app.waitForTimeout(2500);
    await app.takeScreenshot("sidebar-right");
    // Collapsed rail stays on the right edge too
    await app.locator('[data-testid="sidebar-collapse"]').click();
    // (width animates 280 → 44 over 250 ms)
    await expect
      .poll(
        async () => (await app.locator('[data-testid="sidebar-collapsed"]').boundingBox())?.x ?? 0,
      )
      .toBeGreaterThan(width - 60);
    // The rail mirrors the sidebar: project gems · modules · that project's terminals
    const rail = app.locator('[data-testid="sidebar-collapsed"]');
    await expect(rail.locator('[data-testid^="rail-project-"]')).toHaveCount(1);
    await expect(rail.locator('[data-testid="rail-workspace"]')).toHaveCount(0);
    await app.takeScreenshot("sidebar-right-collapsed");
    // Files from the rail expands the sidebar straight into Files
    await rail.locator('[data-testid="rail-files"]').click();
    await expect(app.locator('[data-testid="sidebar-collapsed"]')).toHaveCount(0);
    await expect(app.locator('[data-testid="sidebar-files-toggle"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await app.locator('[data-testid="sidebar-files-toggle"]').click();
    await app.locator('[data-testid="sidebar-collapse"]').click();
    await app.locator('[data-testid="sidebar-expand"]').click();
    await app.reload();
    await expect(app.locator('[data-testid="sidebar"]')).toHaveAttribute("data-side", "right");
    await app.locator('[data-testid="header-sidebar-side-toggle"]').click();
    await app.getByRole("menuitemradio", { name: "Left", exact: true }).click();
    await expect(app.locator('[data-testid="sidebar"]')).toHaveAttribute("data-side", "left");
  });

  test("Settings › Sidebar position switches sides too", async ({ app }) => {
    await app.locator('[data-testid="header-settings"]').click();
    const group = app.locator('[data-testid="settings-sidebar-side"]');
    await group.getByRole("radio", { name: "Right" }).click();
    await expect(app.locator('[data-testid="sidebar"]')).toHaveAttribute("data-side", "right");
    await expect(group.getByRole("radio", { name: "Right" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await app.takeScreenshot("settings-sidebar-side");
    await group.getByRole("radio", { name: "Left" }).click();
    await expect(app.locator('[data-testid="sidebar"]')).toHaveAttribute("data-side", "left");
  });

  test("many projects: the 2-column grid scrolls; backgrounds are pickable", async ({ app }) => {
    for (let i = 1; i <= 9; i++) {
      await app.evaluate((n) => {
        (window as any).__E2E_PICK__ = "C:/code/proj-" + n;
      }, i);
      await openProjects(app);
      await app.locator('[data-testid="legend-add-projects"]').click();
      await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("proj-" + i);
      await openProjects(app);
      await expect(app.locator('[data-testid^="project-box-"]')).toHaveCount(i + 1); // the pick is read async
    }
    await expect(app.locator('[data-testid^="project-box-"]')).toHaveCount(10);
    const grid = app.locator('[data-testid="projects-grid"]');
    const { sh, ch } = await grid.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(sh).toBeGreaterThan(ch); // scrolls instead of pushing the terminals away
    // Two columns: first two tiles share a row
    const [a, b] = [
      await app.locator('[data-testid^="project-box-"]').nth(0).boundingBox(),
      await app.locator('[data-testid^="project-box-"]').nth(1).boundingBox(),
    ];
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    // Background: right-click → Change Appearance… → Ruby
    await app.locator('[data-testid^="project-box-"]').first().click({ button: "right" });
    await app.getByRole("menuitem", { name: "Change Appearance…" }).click();
    const dlg = app.locator('[data-testid="background-dialog"]');
    await dlg.getByRole("button", { name: "Ruby" }).click();
    await expect(dlg.getByRole("button", { name: "Ruby" })).toHaveAttribute("aria-pressed", "true");
    await dlg.getByRole("button", { name: "Pear cut" }).click();
    await expect(dlg.getByRole("button", { name: "Pear cut" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await app.waitForTimeout(300);
    await app.takeScreenshot("projects-background-dialog");
    await app.keyboard.press("Escape");
    await app.waitForTimeout(300);
    await app.takeScreenshot("projects-grid-many");
  });

  test("project picker works from the keyboard and names itself to assistive tech", async ({
    app,
  }) => {
    await app.evaluate(() => localStorage.setItem("show-splash", "false"));
    await app.reload();
    await app.evaluate(() => {
      (window as any).__E2E_PICK__ = "C:/code/keyboard";
    });
    const trigger = app.getByTestId("sidebar-project-picker");
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toHaveAccessibleName(/Home/);
    await openProjects(app);
    await app.locator('[data-testid="legend-add-projects"]').click();
    await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("keyboard");
    await expect(app.locator('[data-testid="projects-grid"]')).toBeHidden();

    // Keyboard: open, focus lands on the current project, Tab stays inside.
    await trigger.focus();
    await app.keyboard.press("Enter");
    const panel = app.getByRole("dialog", { name: "Projects" });
    await expect(panel).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(app.locator('[data-testid^="project-box-"][aria-current="true"]')).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await app.keyboard.press("Tab");
      expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    // Escape closes and returns focus to the trigger.
    await app.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    // Picking another project closes the picker.
    await app.keyboard.press("Enter");
    await app.locator('[data-testid^="project-box-"]').filter({ hasText: "Home" }).click();
    await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("Home");
    await expect(panel).toBeHidden();
  });
});
