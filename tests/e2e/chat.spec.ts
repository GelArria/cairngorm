import { test, expect, setPaneView } from "./fixtures";

test.describe("Chat UI (per-pane)", () => {
  test.beforeEach(async ({ app }) => {
    await setPaneView(app, "Show Chat UI");
    await expect(app.locator('textarea[placeholder="Type a message…"]').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("composer has no buttons and Enter sends (input clears)", async ({ app }) => {
    await expect(app.locator('button:has-text("Send")')).toHaveCount(0);
    await expect(app.locator('button:has-text("Stop")')).toHaveCount(0);
    const input = app.locator('textarea[placeholder="Type a message…"]').first();
    await input.fill("Hello test message");
    await input.press("Enter");
    // Mock backend can't echo a transcript — sending is observable as: input cleared
    await expect(input).toHaveValue("", { timeout: 5000 });
    const shot = await app.takeScreenshot("chat-sent-message");
    console.log(`Screenshot: ${shot}`);
  });

  test("toggle returns the pane to TUI independently", async ({ app }) => {
    await app
      .locator("[data-pane-id]")
      .first()
      .click({ button: "right", position: { x: 200, y: 200 } });
    await app.getByRole("menuitem", { name: "Show TUI" }).click();
    await expect(app.locator(".xterm").first()).toBeVisible({ timeout: 5000 });
    const shot = await app.takeScreenshot("chat-back-to-tui");
    console.log(`Screenshot: ${shot}`);
  });
});
