import { test, expect } from "./fixtures";

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.waitForSelector('[data-testid="sidebar"]');
});

test("app menu groups commands like a desktop menu bar and runs them", async ({ app }) => {
  await app.getByTestId("header-menu").click();
  const menu = app.getByRole("menu", { name: "Application menu" });
  await expect(menu).toBeVisible();
  for (const label of ["File", "View", "Go", "Help"]) {
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toBeVisible();
  }
  await menu.getByRole("menuitem", { name: "File", exact: true }).hover();
  const file = app.getByRole("menu", { name: "File" });
  for (const label of ["New Terminal", "New Project…", "Open Folder…", "Save", "Settings…"]) {
    await expect(file.getByRole("menuitem", { name: new RegExp(label) })).toBeVisible();
  }
  await app.screenshot({
    path: "logs/e2e/app-menu-file.png",
    clip: { x: 0, y: 0, width: 520, height: 470 },
  });

  // Go ▸ Forward has nowhere to go yet: shown, but disabled.
  await menu.getByRole("menuitem", { name: "Go", exact: true }).hover();
  const go = app.getByRole("menu", { name: "Go" });
  await expect(go.getByRole("menuitem", { name: /^Forward/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // View ▸ Calendar runs the same command as its shortcut.
  await menu.getByRole("menuitem", { name: "View", exact: true }).hover();
  const view = app.getByRole("menu", { name: "View" });
  await app.screenshot({
    path: "logs/e2e/app-menu-view.png",
    clip: { x: 0, y: 0, width: 520, height: 520 },
  });
  await view.getByRole("menuitem", { name: /^Calendar/ }).click();
  await expect(menu).toBeHidden();
  await expect(app.getByTestId("mode-calendar")).toHaveAttribute("aria-pressed", "true");
});

test("a diagonal move into a submenu crosses other categories without switching", async ({
  app,
}) => {
  await app.getByTestId("header-menu").click();
  const menu = app.getByRole("menu", { name: "Application menu" });
  await menu.getByRole("menuitem", { name: "File", exact: true }).hover();
  const file = app.getByRole("menu", { name: "File" });
  const target = await file.getByRole("menuitem", { name: /^Settings/ }).boundingBox();
  // Real pointer paths pass over View, Go and Help on the way down to Settings….
  await app.mouse.move(target!.x + 20, target!.y + target!.height / 2, { steps: 12 });
  await expect(file).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "File", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("app menu works from the keyboard", async ({ app }) => {
  await app.getByTestId("header-menu").click();
  const menu = app.getByRole("menu", { name: "Application menu" });
  await expect(menu.getByRole("menuitem", { name: "File", exact: true })).toBeFocused();
  await app.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "View", exact: true })).toBeFocused();
  await app.keyboard.press("ArrowRight");
  const view = app.getByRole("menu", { name: "View" });
  await expect(view.getByRole("menuitem", { name: /^Workspace/ })).toBeFocused();
  await app.keyboard.press("ArrowDown");
  await expect(view.getByRole("menuitem", { name: /^Calendar/ })).toBeFocused();
  // Disabled commands stay reachable and announce themselves as disabled.
  for (let i = 0; i < 4; i++) {
    await app.keyboard.press("ArrowDown");
  }
  const splitDown = view.getByRole("menuitem", { name: /^Split Down/ });
  await expect(splitDown).toBeFocused();
  await expect(splitDown).toHaveAttribute("aria-disabled", "true");
  await app.keyboard.press("ArrowLeft");
  await expect(menu.getByRole("menuitem", { name: "View", exact: true })).toBeFocused();
  // Escape inside a submenu only steps back to its category.
  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("ArrowUp");
  await expect(view.getByRole("menuitem", { name: /^Reset Text Size/ })).toBeFocused();
  await app.keyboard.press("Escape");
  await expect(menu.getByRole("menuitem", { name: "View", exact: true })).toBeFocused();
  await app.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(app.getByTestId("header-menu")).toBeFocused();
});

test("repeated category activation still enters its commands without delaying arrow keys", async ({
  app,
}) => {
  await app.getByTestId("header-menu").click();
  const category = app.getByRole("menu", { name: "Application menu" }).getByRole("menuitem", {
    name: "File",
    exact: true,
  });
  const command = app.getByRole("menu", { name: "File", exact: true }).getByRole("menuitem", {
    name: /^New Terminal/,
  });
  await category.click();
  await expect(command).toBeFocused();
  await category.click();
  await expect(command).toBeFocused();
  await category.focus();
  await app.keyboard.press("ArrowRight");
  await expect(command).toBeFocused();
  await app.keyboard.press("ArrowDown");
  await expect(
    app.getByRole("menu", { name: "File", exact: true }).getByRole("menuitem", {
      name: /^New Cairngorm Agent/,
    }),
  ).toBeFocused();
});

test("Check for Updates says updates are not active until the channel is published", async ({
  app,
}) => {
  await app.evaluate(() => {
    const internals = (window as any).__TAURI_INTERNALS__,
      original = internals.invoke;
    internals.invoke = (cmd: string, args: unknown) =>
      cmd === "update_check"
        ? Promise.resolve({
            state: "disabled",
            current: "0.4.3",
            repo: "GelArria/Cairngorm",
            branch: "main",
            installable: false,
            ready: false,
          })
        : original(cmd, args);
  });
  await app.getByTestId("header-menu").click();
  await app.getByRole("menuitem", { name: "Help", exact: true }).hover();
  await app
    .getByRole("menu", { name: "Help" })
    .getByRole("menuitem", { name: /Check for Updates/ })
    .click();
  const dialog = app.getByTestId("update-dialog");
  await expect(dialog).toContainText("Automatic updates aren't active yet.");
  await expect(dialog).toContainText("You're on version 0.4.3.");
  await expect(dialog).toContainText("GelArria/Cairngorm@main");
  await expect(dialog.getByRole("button", { name: /Install/ })).toHaveCount(0);
  await dialog.screenshot({ path: "logs/e2e/app-menu-updates.png" });
});
