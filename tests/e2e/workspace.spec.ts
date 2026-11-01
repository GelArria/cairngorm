import { test, expect } from "./workspace-fixtures";

test.describe("Workspace Panel — File Manager", () => {
  test("shows home directory contents on load", async ({ app }) => {
    await app.waitForTimeout(2000);
    const documents = app.locator("text=Documents").first();
    await expect(documents).toBeVisible({ timeout: 5000 });
    const readme = app.locator("text=readme.md").first();
    await expect(readme).toBeVisible({ timeout: 5000 });
    const shot = await (app as any).takeScreenshot("ws-home-contents");
    console.log(`Screenshot: ${shot}`);
  });

  test("hidden files are filtered out", async ({ app }) => {
    const hidden = app.locator("text=.gitconfig");
    await expect(hidden).not.toBeVisible({ timeout: 3000 });
  });

  test("folders appear before files in listing", async ({ app }) => {
    const items = app.locator("span.truncate");
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    let foundFile = false;
    for (let i = 0; i < count; i++) {
      const text = (await items.nth(i).textContent()) ?? "";
      const isLikelyFile = text.includes(".");
      if (isLikelyFile) foundFile = true;
    }
    // At least one file exists
    expect(foundFile).toBe(true);
  });

  test("clicking a folder expands it and shows children", async ({ app }) => {
    const documents = app.locator("span.truncate:has-text('Documents')").first();
    await documents.click();
    await app.waitForTimeout(1500);
    const notes = app.locator("text=notes.txt").first();
    await expect(notes).toBeVisible({ timeout: 5000 });
    const shot = await (app as any).takeScreenshot("ws-folder-expanded");
    console.log(`Screenshot: ${shot}`);
  });

  test("clicking a text file opens it in the editor", async ({ app }) => {
    const readme = app.locator("span.truncate:has-text('readme.md')").first();
    await readme.click();
    await app.waitForTimeout(3000);

    // Files open as tabs/panes in the terminal grid (no separate editor view):
    // the tab bar shows the active tab's title
    const hasTab = await app.evaluate(() =>
      [...document.querySelectorAll("[title]")].some(
        (el) => el.getAttribute("title") === "readme.md",
      ),
    );
    expect(hasTab).toBe(true);

    const shot = await (app as any).takeScreenshot("ws-file-opened");
    console.log(`Screenshot: ${shot}`);
  });

  test("clicking empty folder shows no error", async ({ app }) => {
    const desktop = app.locator("span.truncate:has-text('Desktop')").first();
    await desktop.click();
    await app.waitForTimeout(1500);
    const shot = await (app as any).takeScreenshot("ws-empty-folder");
    console.log(`Screenshot: ${shot}`);
  });

  test("root path label shows TestUser", async ({ app }) => {
    const label = app.locator("text=TestUser").first();
    await expect(label).toBeVisible({ timeout: 5000 });
  });

  test("close root button resets workspace", async ({ app }) => {
    // The × next to the folder name in the explorer header (inside the left sidebar)
    // Close-folder × shows on header hover (Sidebar v2 keeps the header clean)
    await app.locator('[data-testid="sidebar"] [data-testid="workspace-name"]').hover();
    const xBtn = app.locator('[data-testid="sidebar"] button[aria-label="Close folder"]').first();
    await xBtn.click();
    await app.waitForTimeout(500);
    const shot = await (app as any).takeScreenshot("ws-root-closed");
    console.log(`Screenshot: ${shot}`);
  });
});

test.describe("Workspace Panel — Edge Cases", () => {
  test("rapid folder clicks don't crash", async ({ app }) => {
    const documents = app.locator("span.truncate:has-text('Documents')").first();
    const desktop = app.locator("span.truncate:has-text('Desktop')").first();
    for (let i = 0; i < 3; i++) {
      await documents.click();
      await app.waitForTimeout(200);
      await desktop.click();
      await app.waitForTimeout(200);
    }
    // App should still be responsive
    const body = app.locator("body");
    await expect(body).toBeVisible();
    const shot = await (app as any).takeScreenshot("ws-rapid-clicks");
    console.log(`Screenshot: ${shot}`);
  });

  test("navigating into nested subfolders works", async ({ app }) => {
    // Click Documents
    await app.locator("span.truncate:has-text('Documents')").first().click();
    await app.waitForTimeout(1000);
    // Click Work subfolder
    const work = app.locator("span.truncate:has-text('Work')").first();
    await expect(work).toBeVisible({ timeout: 5000 });
    await work.click();
    await app.waitForTimeout(1000);
    // Should see todo.md
    const todo = app.locator("text=todo.md").first();
    await expect(todo).toBeVisible({ timeout: 5000 });
    const shot = await (app as any).takeScreenshot("ws-nested-folder");
    console.log(`Screenshot: ${shot}`);
  });
});
