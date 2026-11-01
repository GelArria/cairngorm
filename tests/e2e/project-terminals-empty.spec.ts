import { test, expect } from "./fixtures";

test("empty project terminals: responsive layout and keyboard launch", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  const sidebar = app.locator('[data-testid="sidebar"]');
  const terminals = sidebar.locator('[data-testid="project-terminals"]');
  const empty = terminals.locator('[data-testid="project-terminals-empty"]');
  const launch = empty.getByRole("button", { name: "New terminal", exact: true });
  await expect(empty.getByRole("heading", { name: "Nothing open yet" })).toBeVisible();
  await expect(empty).toContainText("Open a shell to work in this project.");
  await app.takeScreenshot("project-terminals-empty-context");
  await empty.screenshot({ path: "logs/e2e/project-terminals-empty.png" });

  // Exercise the real sidebar resize handle, including its minimum width.
  const resizable = sidebar.locator("../..");
  const handle = resizable.locator(".cursor-col-resize");
  for (const width of [260, 450]) {
    const bounds = (await handle.boundingBox())!;
    const current = (await resizable.boundingBox())!.width;
    await app.mouse.move(bounds.x + bounds.width / 2, bounds.y + 200);
    await app.mouse.down();
    // Exactly to the minimum: dragging well past it folds the sidebar into its rail.
    const delta = width === 260 ? width - current : 1000;
    await app.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + 200, { steps: 5 });
    await app.mouse.up();
    await expect.poll(async () => Math.round((await resizable.boundingBox())!.width)).toBe(width);
    expect(await empty.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(launch).toBeInViewport();
    await launch.focus();
    await expect(launch).toBeFocused();
    await empty.screenshot({ path: `logs/e2e/project-terminals-empty-${width}.png` });
  }

  await launch.press("Enter");
  await expect(empty).toHaveCount(0);
  const row = terminals.locator('[data-testid^="term-"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-current", "true");
  await sidebar.screenshot({ path: "logs/e2e/sidebar-terminal-spacing.png" });
  await expect(app.locator('[data-testid="mode-chat"]')).toHaveCount(0);
  await row.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Close Terminal", exact: true }).click();
  await expect(empty).toBeVisible();
});
