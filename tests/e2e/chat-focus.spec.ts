import { test, expect, setPaneView } from "./fixtures";

// Focus regression: the Chat UI composer used to never take focus — after a
// click/selection the focus died in <body> and typed keys were lost (user had
// to click the textarea directly).
test.describe("Chat UI composer focus", () => {
  test.beforeEach(async ({ app }) => {
    await setPaneView(app, "Show Chat UI");
    await expect(app.locator('textarea[placeholder="Type a message…"]').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("click in the transcript focuses the composer (type straight away)", async ({ app }) => {
    const input = app.locator('textarea[placeholder="Type a message…"]').first();
    // Click the transcript (empty state), NOT the textarea
    await app.locator("text=Waiting for agent events").first().click();
    await app.keyboard.type("hello");
    await expect(input).toHaveValue("hello", { timeout: 2000 });
  });

  test("typing without focus lands in the composer (type-anywhere)", async ({ app }) => {
    const input = app.locator('textarea[placeholder="Type a message…"]').first();
    await app.keyboard.type("typed-anywhere");
    await expect(input).toHaveValue("typed-anywhere", { timeout: 2000 });
  });

  test("a hidden terminal cannot keep typed input or send it to the PTY", async ({ app }) => {
    const input = app.getByPlaceholder("Type a message…");
    await app.evaluate(() => {
      const w = window as any;
      const original = w.__TAURI_INTERNALS__.invoke;
      w.__CHAT_PTY_WRITES__ = [];
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown) => {
        if (cmd === "pty_write") w.__CHAT_PTY_WRITES__.push(args);
        return original(cmd, args);
      };
      document.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")!.focus();
    });
    await app.keyboard.type("only-in-chat");
    await expect(input).toHaveValue("only-in-chat");
    expect(await app.evaluate(() => (window as any).__CHAT_PTY_WRITES__)).toEqual([]);
    await app.screenshot({ path: "logs/e2e/chat-focus-restored.png", animations: "disabled" });
  });
});
