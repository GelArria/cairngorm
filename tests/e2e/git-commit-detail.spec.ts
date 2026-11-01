import { test, expect } from "./fixtures";

async function history(app: import("@playwright/test").Page) {
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__DETAIL_CALLS__ = [];
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      w.__DETAIL_CALLS__.push({ cmd, args });
      if (cmd === "git_branches") return Promise.resolve(["main"]);
      if (cmd === "git_commit_details")
        return Promise.resolve({
          hash: "abc1234".padEnd(40, "0"),
          author: "Test Author",
          email: "dev@example.invalid",
          date: "2026-10-05T10:30:00+00:00",
          refs: ["HEAD -> main", "origin/main"],
          message:
            "feat: implement commit details\n\nFull body that is not available in the history subject.\nAnother paragraph.",
          files: [
            { path: "src/one.ts", status: "M", added: 1, removed: 1 },
            { path: "src/two.ts", status: "A", added: 1, removed: 0 },
          ],
        });
      if (cmd === "git_commit_diff")
        return Promise.resolve(
          `diff --git a/${args.path} b/${args.path}\n--- a/${args.path}\n+++ b/${args.path}\n@@ -1 +1 @@\n-old line\n+historical ${args.path}\n`,
        );
      return original(cmd, args);
    };
  });
  await app.getByTestId("sidebar-git-toggle").click();
  await app.getByRole("tab", { name: "History", exact: true }).click();
}

test("clicking a history commit opens full details and its historical file diffs", async ({
  app,
}) => {
  await history(app);
  await app.getByTestId("git-commit-row").first().click();
  const detail = app.getByTestId("git-commit-detail");
  await expect(detail).toBeVisible({ timeout: 5000 });
  await expect(detail).toContainText("Test Author");
  await expect(detail).toContainText("dev@example.invalid");
  await expect(detail).toContainText("Full body that is not available in the history subject.");
  await expect(detail).toContainText("abc1234".padEnd(40, "0"));
  await expect(detail.getByTestId("git-commit-file")).toHaveCount(2);
  await expect(detail.getByTestId("diff-view")).toContainText("historical src/one.ts");
  await detail.getByTestId("git-commit-file").filter({ hasText: "two.ts" }).click();
  await expect(detail.getByTestId("diff-view")).toContainText("historical src/two.ts");
  const calls = await app.evaluate(() => (window as any).__DETAIL_CALLS__);
  expect(calls.find((a: any) => a.cmd === "git_commit_details").args.hash).toBe("abc1234");
  expect(calls.filter((a: any) => a.cmd === "git_commit_diff").at(-1).args.path).toBe("src/two.ts");
  await app.screenshot({ path: "logs/e2e/git-commit-details.png", animations: "disabled" });
  await detail.evaluate((el) => {
    Object.assign((el as HTMLElement).style, { width: "320px", maxWidth: "320px" });
  });
  const sizes = await detail.evaluate((el) => ({
    width: el.clientWidth,
    filesWidth: el.querySelector("nav")!.getBoundingClientRect().width,
    scrollWidth: el.scrollWidth,
  }));
  expect(sizes.filesWidth).toBeLessThanOrEqual(sizes.width);
  expect(sizes.filesWidth).toBeGreaterThanOrEqual(sizes.width - 1);
  expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.width);
  await detail.screenshot({
    path: "logs/e2e/git-commit-details-narrow.png",
    animations: "disabled",
  });
});

test("keyboard opens details, and failed loading can be retried", async ({ app }) => {
  await history(app);
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    let failed = false;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      if (cmd === "git_commit_details" && !failed) {
        failed = true;
        return Promise.reject("Commit could not be read");
      }
      return original(cmd, args);
    };
  });
  await app.getByTestId("git-commit-row").first().press("Enter");
  await expect(app.getByText("Commit could not be read", { exact: true })).toBeVisible();
  await app.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(app.getByTestId("git-commit-detail")).toContainText("Test Author");
});
