import { test, expect } from "./fixtures";

test.describe("Git panel in module toolbar", () => {
  test("toggle shows git panel with branch, files and per-file meta", async ({ app }) => {
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect(app.locator('[data-testid="git-panel"]')).toBeVisible({ timeout: 3000 });
    await expect(app.locator('[data-testid="git-branch"]')).toHaveText("main");
    await expect(app.locator('[data-testid="git-file-row"]')).toHaveCount(2);
    await app.locator('[data-testid="git-file-row"]').first().click();
    await expect(app.locator('[data-testid="git-file-meta"]').first()).toContainText("GelArria");
    await expect(app.locator('[data-testid="git-file-meta"]').first()).toContainText("abc1234");
    const shot = await app.takeScreenshot("git-panel-open");
    console.log(`Screenshot: ${shot}`);
  });

  test("opening Git refetches immediately, with compact rows and commit above Changes", async ({
    app,
  }) => {
    await app.evaluate(() => {
      const internals = (window as any).__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = (cmd: string, args: unknown) => {
        if (cmd === "git_status") {
          (window as any).__GIT_REFRESHES__ = ((window as any).__GIT_REFRESHES__ ?? 0) + 1;
          return Promise.resolve({ files: [{ path: "src/fresh.ts", code: " M" }], error: null });
        }
        return original(cmd, args);
      };
    });
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect(app.locator('[data-testid="git-file-row"]')).toHaveText(/fresh.ts/);
    const row = await app.locator('[data-testid="git-file-row"]').boundingBox();
    const box = await app.locator('[data-testid="git-commit-box"]').boundingBox();
    expect(row!.height).toBeLessThanOrEqual(24);
    expect(box!.y + box!.height).toBeLessThan(row!.y);
    await expect(app.locator('[data-testid="git-commit-message"]')).toBeVisible();
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect.poll(() => app.evaluate(() => (window as any).__GIT_REFRESHES__)).toBe(2);
    await app.getByRole("tab", { name: "History" }).click();
    await expect(app.locator('[data-testid="git-history"]')).toBeVisible();
    await expect(app.locator('[data-testid="git-file-row"]')).toHaveCount(0);
    await app
      .locator('[data-testid="sidebar"]')
      .screenshot({ path: "logs/e2e/git-history-tab.png", animations: "disabled" });
    await app.getByRole("tab", { name: "History" }).press("ArrowLeft");
    await expect(app.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(app.locator('[data-testid="git-history"]')).toHaveCount(0);
    await app
      .locator('[data-testid="sidebar"]')
      .screenshot({ path: "logs/e2e/git-changes-compact.png", animations: "disabled" });
  });

  test("commit modes, errors and Pull/Fetch are wired", async ({ app }) => {
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await app.locator('[data-testid="git-commit-message"]').fill("test commit");
    await app.getByRole("button", { name: "Commit options", exact: true }).click();
    await app.getByRole("menuitemradio", { name: "Commit Tracked" }).click();
    await app.evaluate(() => {
      const internals = (window as any).__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = (cmd: string, args: unknown) => {
        if (cmd === "git_commit") {
          (window as any).__COMMIT_ARGS__ = args;
          return Promise.resolve({ files: [], error: "hook failed" });
        }
        return original(cmd, args);
      };
    });
    await app.locator('[data-testid="git-commit-btn"]').click();
    await expect(app.getByText("hook failed").last()).toBeVisible();
    await expect(app.locator('[data-testid="git-commit-message"]')).toHaveValue("test commit");
    expect(await app.evaluate(() => (window as any).__COMMIT_ARGS__.mode)).toBe("tracked");
    await expect(app.locator('[data-testid="git-file-row"]')).toHaveCount(2);
    await app.locator('[data-testid="git-pull"]').click();
    await expect
      .poll(() =>
        app.evaluate(() =>
          (window as any).__CMD_LOG__.some((v: string) => v.includes('"action":"pull"')),
        ),
      )
      .toBe(true);
    await app.getByRole("button", { name: "Git actions", exact: true }).click();
    await app.getByRole("menuitem", { name: "Fetch", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(() =>
          (window as any).__CMD_LOG__.some((v: string) => v.includes('"action":"fetch"')),
        ),
      )
      .toBe(true);
    await app.getByRole("button", { name: "Commit options", exact: true }).click();
    await app.getByRole("menuitemradio", { name: "Commit All", exact: true }).click();
    await expect(app.locator('[data-testid="git-commit-btn"]')).toHaveText("Commit All");
    await app.locator('[data-testid="git-commit-btn"]').click();
    await expect.poll(() => app.evaluate(() => (window as any).__COMMIT_ARGS__.mode)).toBe("all");
  });

  test("clicking a file row opens its diff in the editor", async ({ app }) => {
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect(app.locator('[data-testid="git-panel"]')).toBeVisible({ timeout: 3000 });
    await app.locator('[data-testid="git-file-row"]').first().click();
    // app-switch-view + editor-open-file → unified tab system opens the diff content
    await expect(app.getByTestId("diff-after").filter({ hasText: "// new line" })).toBeVisible({
      timeout: 5000,
    });
    const shot = await app.takeScreenshot("git-diff-editor");
    console.log(`Screenshot: ${shot}`);
  });

  test("the Git button again closes Git (back to the terminals)", async ({ app }) => {
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect(app.locator('[data-testid="git-panel"]')).toBeVisible({ timeout: 3000 });
    await app.locator('[data-testid="sidebar-git-toggle"]').click();
    await expect(app.locator('[data-testid="git-panel"]')).toBeHidden();
    const shot = await app.takeScreenshot("git-panel-closed");
    console.log(`Screenshot: ${shot}`);
  });
});
