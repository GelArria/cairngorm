import { test, expect } from "./fixtures";

test("an aged terminal survives X until explicitly confirmed", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const opened = new Date("2026-10-11T12:00:00Z");
  await app.clock.setFixedTime(opened);
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  const bar = app.getByRole("tablist", { name: "Workspace tabs" });
  await expect(bar.getByRole("tab")).toHaveCount(1);
  await app.clock.setFixedTime(new Date(opened.getTime() + 5 * 60_000));
  await app.getByRole("button", { name: "Menu", exact: true }).focus();
  await app.keyboard.press("Control+Shift+T");
  await expect(bar.getByRole("tab")).toHaveCount(2);
  const closeFirst = bar.getByRole("button", { name: "Close tab", exact: true }).first();
  await closeFirst.click();
  await expect(app.getByRole("dialog", { name: "Close terminal?", exact: true })).toBeVisible();
  await expect(bar.getByRole("tab")).toHaveCount(2);
  await expect(app.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await app.keyboard.press("Enter");
  await expect(app.getByRole("dialog")).toHaveCount(0);
  await expect(bar.getByRole("tab")).toHaveCount(2);
  await app.clock.setFixedTime(new Date(opened.getTime() + 5 * 60_000 + 200));
  await closeFirst.click();
  await app.screenshot({
    path: "logs/e2e/terminal-close-confirmation.png",
    animations: "disabled",
  });
  await app.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(bar.getByRole("tab")).toHaveCount(2);
  await app.clock.setFixedTime(new Date(opened.getTime() + 5 * 60_000 + 500));
  await closeFirst.click();
  await app
    .getByRole("dialog")
    .getByRole("button", { name: "Close terminal", exact: true })
    .click();
  await expect(bar.getByRole("tab")).toHaveCount(1);
  await expect(bar.getByRole("tab")).toHaveAccessibleName(/Code 2/);
});

test("middle click, context menus and both close shortcuts cannot bypass protection", async ({
  app,
}) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const opened = new Date("2026-10-11T12:00:00Z");
  await app.clock.setFixedTime(opened);
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  const tab = app.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab");
  await app.clock.setFixedTime(new Date(opened.getTime() + 6 * 60_000));
  await tab.click({ button: "middle" });
  await expect(app.getByRole("dialog", { name: "Close terminal?" })).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(tab).toHaveCount(1);
  await tab.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Close pane", exact: true }).click();
  await expect(app.getByRole("dialog", { name: "Close terminal?" })).toBeVisible();
  await app.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await app
    .getByTestId("project-terminals")
    .locator('[data-testid^="term-"]')
    .click({ button: "right" });
  await app.getByRole("menuitem", { name: "Close Terminal", exact: true }).click();
  await expect(app.getByRole("dialog", { name: "Close terminal?" })).toBeVisible();
  await app.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const key of ["Control+w", "Control+Shift+w"]) {
    await tab.focus();
    await app.keyboard.press(key);
    await expect(app.getByRole("dialog", { name: "Close terminal?" })).toBeVisible();
    await app.keyboard.press("Escape");
    await expect(tab).toHaveCount(1);
  }
});

test("restoring preserves protection and the dialog fits a narrow window", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const opened = new Date("2026-10-11T12:00:00Z");
  await app.clock.setFixedTime(opened);
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  await app.clock.setFixedTime(new Date(opened.getTime() + 7 * 60_000));
  await app.reload();
  await app.setViewportSize({ width: 460, height: 720 });
  const bar = app.getByRole("tablist", { name: "Workspace tabs" });
  await bar.getByRole("button", { name: "Close tab", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Close terminal?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText("Are you sure?");
  await expect(dialog).not.toContainText("7 minutes");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Close terminal", exact: true }),
  ).toBeInViewport();
  await app.screenshot({
    path: "logs/e2e/terminal-close-confirmation-narrow.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(bar.getByRole("tab")).toHaveCount(1);
});
