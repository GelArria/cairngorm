import { test, expect } from "./fixtures";

test.describe("Non-agent tabs have no Chat UI", () => {
  // Regression: a plain terminal (powershell/git bash) has no chat view — flipping
  // it to Chat UI used to leave a BLANK pane. The toggle is per pane now and is
  // only offered on agent panes, so a shell can never be switched away.
  test("plain terminal offers no Chat UI toggle and stays visible", async ({ app }) => {
    // Create a non-agent terminal tab: "+" opens the shell menu → "Default shell"
    // (e2e mocks detect_shells → empty list, so the fallback item shows)
    await app.locator('button[aria-label="New terminal"]').first().click();
    await app.getByText("Default shell").click();
    const visibleXterm = app.locator(".xterm-rows:visible").first();
    await expect(visibleXterm).toBeVisible({ timeout: 8000 });

    // The shell's pane menu: edit actions yes, view toggle no
    await app.locator("div.cursor-grab[title]").last().click({ button: "right" });
    await expect(app.getByRole("menuitem", { name: "Rename pane" })).toBeVisible();
    await expect(app.getByRole("menuitem", { name: /Show (Chat UI|TUI)/ })).toHaveCount(0);
    await app.keyboard.press("Escape");
    await expect(visibleXterm).toBeVisible();

    const shot = await app.takeScreenshot("chat-toggle-plain-terminal-visible");
    console.log(`Screenshot: ${shot}`);
  });
});
