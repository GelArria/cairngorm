import { test, expect } from "./fixtures";

test.describe("Font zoom × detach/reattach", () => {
  // Reattach/new-tab path: a terminal must be BORN at the persisted zoom
  // (localStorage shared by main + detached webviews) — no flash, no broken open.
  test("new terminal tab mounts at persisted font size", async ({ app }) => {
    await app.evaluate(() => localStorage.setItem("panel-font-size", "18"));
    await app.goto("/"); // reload → app boots with the persisted zoom
    await app.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });

    const newTabBtn = app.locator('button[aria-label="New terminal"]').first();
    await newTabBtn.click();
    await app.getByRole("menuitem", { name: "Default shell", exact: true }).click();

    await expect(app.locator(".xterm-rows").first()).toBeVisible({ timeout: 8000 });
    await expect
      .poll(() =>
        app.evaluate(() => getComputedStyle(document.querySelector(".xterm-rows")!).fontSize),
      )
      .toBe("18px");
    const shot = await app.takeScreenshot("zoom-04-new-terminal-persisted");
    console.log(`Screenshot: ${shot}`);
  });
});
