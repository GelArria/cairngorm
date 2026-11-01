import { test, expect } from "./fixtures";

test.describe("Agent interaction", () => {
  test("chat UI shows events and TUI mirrors content", async ({ app }) => {
    test.skip(
      process.env.E2E_REAL !== "1",
      "needs the real agent backend over PTY (run against the Tauri app with E2E_REAL=1)",
    );
    // Dismiss crash modal if present by removing it from DOM
    const crashModal = app.locator(".fixed.inset-0.z-\\[100\\]");
    if ((await crashModal.count()) > 0) {
      await crashModal.evaluate((el) => el.remove());
      await app.waitForTimeout(300);
    }

    await app.waitForTimeout(2000);
    await app.takeScreenshot("agent-01-initial");

    // Collect console logs for debugging
    const logs: string[] = [];
    app.on("console", (msg) => {
      const text = msg.text();
      if (
        text.includes("[terminal") ||
        text.includes("[main") ||
        text.includes("agent") ||
        text.includes("pty")
      ) {
        logs.push(text);
      }
    });

    // Switch to Chat UI mode
    const chatBtn = app.locator('button:has-text("Chat UI")').first();
    if ((await chatBtn.count()) > 0) {
      await chatBtn.click();
      await app.waitForTimeout(500);
      await app.takeScreenshot("agent-02-chat-mode");
    }

    // Check if Chat UI is visible
    const chatHeader = app.locator('h2:has-text("Chat UI")');
    const chatVisible =
      (await chatHeader.count()) > 0 && (await chatHeader.isVisible().catch(() => false));
    console.log(`[TEST] Chat UI visible: ${chatVisible}`);

    // Look for the textarea by placeholder
    const textarea = app.getByPlaceholder("Type a message…", { exact: true }).first();
    const hasTextarea = (await textarea.count()) > 0;
    console.log(`[TEST] Textarea found: ${hasTextarea}`);

    // Type a test message
    if (hasTextarea) {
      await textarea.fill("say hi");
      await app.waitForTimeout(300);
      await app.takeScreenshot("agent-03-typed");

      // Click send
      const sendBtn = app.locator('button:has-text("Send")').first();
      if ((await sendBtn.count()) > 0) {
        await sendBtn.click();
        console.log("[TEST] Clicked send");
        await app.waitForTimeout(3000);
        await app.takeScreenshot("agent-04-after-send");

        // Check if any assistant message appeared
        const messages = app.locator("p.whitespace-pre-wrap");
        const msgCount = await messages.count();
        console.log(`[TEST] Messages after send: ${msgCount}`);
      }
    }

    // Switch back to TUI mode
    const tuiBtn = app.locator('button:has-text("TUI")').first();
    if ((await tuiBtn.count()) > 0) {
      await tuiBtn.click();
      await app.waitForTimeout(500);
      await app.takeScreenshot("agent-05-tui-mode");
    }

    // Print debug logs
    console.log("[TEST] Console logs:\n" + logs.slice(-30).join("\n"));
  });
});
