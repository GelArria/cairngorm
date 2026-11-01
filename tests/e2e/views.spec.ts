import { test, expect } from "./fixtures";

test.describe("Views", () => {
  test("calendar view shows week grid", async ({ app }) => {
    await app.locator('[data-testid="mode-calendar"]').click();
    await expect(app.locator('[data-testid="calendar-view"]')).toBeVisible({ timeout: 3000 });
    await app.getByRole("radio", { name: "Calendar events" }).click();
    // The retained event calendar remains separate from scheduled agent tasks.
    await expect(
      app.locator('[data-testid="calendar-view"]').getByText("Sprint planning").first(),
    ).toBeVisible();
    const shot = await app.takeScreenshot("view-calendar");
    console.log(`Screenshot: ${shot}`);
  });
});
