import { test, expect, setPaneView } from "./fixtures";

test.describe("Font zoom (Ctrl +/-/0)", () => {
  test("zooms terminal TUI and Chat UI", async ({ app }) => {
    // Chat UI first — it is the default agent view per the existing chat spec
    await setPaneView(app, "Show Chat UI");
    await expect(app.locator('textarea[placeholder="Type a message…"]').first()).toBeVisible({
      timeout: 5000,
    });

    const chatRoot = app.locator('div[style*="zoom"]').first();
    await expect(chatRoot).toBeVisible();
    await expect(chatRoot).toHaveAttribute("style", /zoom:\s*1;?/);
    const before = await app.takeScreenshot("zoom-01-chat-default");

    for (let i = 0; i < 4; i++) await app.keyboard.press("Control+=");

    await expect(chatRoot).toHaveAttribute("style", /zoom:\s*1\.28/);
    await expect.poll(() => app.evaluate(() => localStorage.getItem("panel-font-size"))).toBe("18");
    const zoomed = await app.takeScreenshot("zoom-02-chat-zoomed");

    // Back to TUI — same shared font size applies to xterm (DOM .xterm-screen carries the inline font-size)
    await setPaneView(app, "Show TUI");
    await expect(app.locator(".xterm").first()).toBeVisible({ timeout: 5000 });
    await expect
      .poll(() =>
        app.evaluate(() => getComputedStyle(document.querySelector(".xterm-rows")!).fontSize),
      )
      .toBe("18px");
    await expect.poll(() => app.evaluate(() => localStorage.getItem("panel-font-size"))).toBe("18");

    // Reset with Ctrl+0
    await app.keyboard.press("Control+0");
    await expect.poll(() => app.evaluate(() => localStorage.getItem("panel-font-size"))).toBe("14");
    await app.takeScreenshot("zoom-03-reset");

    console.log(`[TEST] Screenshots: ${before}, ${zoomed}`);
  });
});
