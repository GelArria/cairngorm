import { test, expect } from "./fixtures";

test.describe("Sidebar panel switching", () => {
  test("opens the Calendar panel", async ({ app }) => {
    await app.locator('[data-testid="mode-calendar"]').click();
    await expect(app.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 3000 });
    const shot = await app.takeScreenshot("mode-calendar");
    console.log(`Screenshot: ${shot}`);
  });

  test("switches back to the empty workspace without auto-launching an agent", async ({ app }) => {
    await app.locator('[data-testid="mode-calendar"]').click();
    await expect(app.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 3000 });
    // Calendar is a toggle of the selected project: again = back to its terminals
    await app.locator('[data-testid="mode-calendar"]').click();
    await expect(app.locator('[data-testid="terminal-empty"]')).toBeVisible({ timeout: 3000 });
    await expect(app.locator('[data-testid="agent-problem"]')).toHaveCount(0);
    const shot = await app.takeScreenshot("mode-chat");
    console.log(`Screenshot: ${shot}`);
  });
});
