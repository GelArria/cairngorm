import { test, expect } from "./fixtures";

test.describe("Terminal edge cases", () => {
  test("full terminal lifecycle", async ({ app }) => {
    test.skip(
      process.env.E2E_REAL !== "1",
      "needs a real PTY backend (run against the Tauri app with E2E_REAL=1)",
    );
    // Dismiss crash modal if present
    const closeCrashBtn = app.locator('button:has-text("Close App")');
    if ((await closeCrashBtn.count()) > 0 && (await closeCrashBtn.isVisible())) {
      await closeCrashBtn.click();
      await app.waitForTimeout(500);
    }

    // 1. Initial state screenshot
    await app.waitForTimeout(2000);
    let shot = await app.takeScreenshot("terminal-01-initial");
    console.log(`[TEST] Screenshot: ${shot}`);

    // 2. Terminal area visible
    const terminalArea = app.locator(".bg-black.font-mono").first();
    await expect(terminalArea).toBeVisible();

    // 3. Open a new terminal via + button
    const newTabBtn = app.locator('button[aria-label="New terminal"]').first();
    if ((await newTabBtn.count()) > 0) {
      await newTabBtn.click();
      await app.waitForTimeout(800);
      shot = await app.takeScreenshot("terminal-02-new-tab");
      console.log(`[TEST] Screenshot: ${shot}`);
    }

    // 4. Split terminal
    const splitBtn = app.locator('button[title="Split terminal"]').first();
    if ((await splitBtn.count()) > 0) {
      await splitBtn.click();
      await app.waitForTimeout(1500);
      shot = await app.takeScreenshot("terminal-03-split");
      console.log(`[TEST] Screenshot: ${shot}`);

      const grid = app.locator('[style*="gridTemplateColumns"]').first();
      const children = await grid.locator("> div").count();
      console.log(`[TEST] Split children count: ${children}`);
      expect(children).toBeGreaterThanOrEqual(2);
    }

    // 5. Unsplit
    const unsplitBtn = app.locator('button[title="Unsplit terminals"]').first();
    if ((await unsplitBtn.count()) > 0) {
      await unsplitBtn.click();
      await app.waitForTimeout(800);
      shot = await app.takeScreenshot("terminal-04-unsplit");
      console.log(`[TEST] Screenshot: ${shot}`);
    }

    // 6. Close extra tabs
    const closeBtns = app.locator("span.text-muted-foreground\\/40");
    const count = await closeBtns.count();
    console.log(`[TEST] Close buttons: ${count}`);
    for (let i = count - 1; i >= 0; i--) {
      try {
        await closeBtns.nth(i).click();
      } catch {
        /* ignore */
      }
      await app.waitForTimeout(400);
    }
    shot = await app.takeScreenshot("terminal-05-closed");
    console.log(`[TEST] Screenshot: ${shot}`);

    // Collect and print browser console logs
    const logs: any[] = [];
    app.on("console", (msg) => {
      if (msg.text().includes("[terminal-") || msg.text().includes("[TEST]")) {
        logs.push(msg.text());
      }
    });
    await app.waitForTimeout(500);
    console.log("[TEST] Terminal debug logs:\n" + logs.slice(-30).join("\n"));
  });
});
