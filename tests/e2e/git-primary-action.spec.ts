import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function setup(app: Page, upstream = true, remote: string | null = "origin") {
  await app.evaluate(
    ({ upstream, remote }) => {
      const w = window as any,
        original = w.__TAURI_INTERNALS__.invoke;
      w.__PRIMARY_CALLS__ = [];
      w.__PRIMARY_FILES__ = [
        { path: "selected.ts", code: " M" },
        { path: "keep.ts", code: " M" },
      ];
      w.__PRIMARY_REMOTE__ = { ahead: 0, behind: 0, remote, upstream };
      w.__PRIMARY_FAIL__ = false;
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
        w.__PRIMARY_CALLS__.push({ cmd, args });
        if (cmd === "git_status")
          return Promise.resolve({ files: w.__PRIMARY_FILES__, error: null });
        if (cmd === "git_remote_status") return Promise.resolve({ ...w.__PRIMARY_REMOTE__ });
        if (cmd === "git_remotes") return Promise.resolve(remote ? [remote] : []);
        if (cmd === "git_stage") {
          w.__PRIMARY_FILES__ = w.__PRIMARY_FILES__.map((f: any) =>
            args.all || args.paths.includes(f.path) ? { ...f, code: "M " } : f,
          );
          return Promise.resolve({ files: w.__PRIMARY_FILES__, error: null });
        }
        if (cmd === "git_commit") {
          if (w.__PRIMARY_FAIL__)
            return Promise.resolve({ files: [], error: "Hook rejected commit" });
          w.__PRIMARY_FILES__ = w.__PRIMARY_FILES__.filter((f: any) => f.code !== "M ");
          w.__PRIMARY_REMOTE__.ahead++;
          return Promise.resolve({ files: w.__PRIMARY_FILES__, error: null });
        }
        if (cmd === "git_sync" && ["push", "push-upstream", "publish"].includes(args.action)) {
          if (w.__PRIMARY_FAIL__) return Promise.reject("Push rejected by remote");
          w.__PRIMARY_REMOTE__.ahead = 0;
          w.__PRIMARY_REMOTE__.upstream = true;
          return Promise.resolve(null);
        }
        return original(cmd, args);
      };
    },
    { upstream, remote },
  );
  await app.getByTestId("git-footer").click();
}

test("select → Commit below form → Push to origin; unselected files are kept", async ({ app }) => {
  await setup(app);
  const commit = app.getByTestId("git-commit-btn");
  await expect(commit).toHaveText("Commit");
  await expect(commit).toBeDisabled();
  await app
    .getByTestId("git-file-row")
    .filter({ hasText: "selected.ts" })
    .getByRole("checkbox")
    .click();
  await app.getByTestId("git-commit-message").fill("feat: selected change");
  await expect(commit).toBeEnabled();
  await app
    .getByTestId("git-commit-box")
    .screenshot({ path: "logs/e2e/git-primary-commit.png", animations: "disabled" });
  await commit.click();
  const push = app.getByTestId("git-primary-push");
  await expect(push).toHaveText("Push to origin");
  await expect(app.getByTestId("git-file-row")).toHaveCount(1);
  await expect(app.getByTestId("git-file-row")).toContainText("keep.ts");
  await app
    .getByTestId("git-commit-box")
    .screenshot({ path: "logs/e2e/git-primary-push.png", animations: "disabled" });
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await expect(app.getByRole("menuitem", { name: "Push", exact: true })).toBeVisible();
  await app
    .getByRole("menu")
    .screenshot({ path: "logs/e2e/git-primary-push-menu.png", animations: "disabled" });
  await app.keyboard.press("Escape");
  await push.click();
  await expect(commit).toBeVisible();
  await expect(commit).toBeDisabled();
  const calls = await app.evaluate(() => (window as any).__PRIMARY_CALLS__);
  expect(calls.find((c: any) => c.cmd === "git_commit").args).toMatchObject({
    mode: "staged",
    message: "feat: selected change",
  });
  const root = calls.find((c: any) => c.cmd === "git_commit").args.root;
  expect(calls.filter((c: any) => c.cmd === "git_sync").map((c: any) => c.args)).toEqual([
    { root, action: "push-upstream", remote: "origin" },
  ]);
});

test("existing outgoing commits use the actual upstream remote; push failure stays retryable", async ({
  app,
}) => {
  await setup(app, true, "backup");
  await app.evaluate(() => {
    (window as any).__PRIMARY_REMOTE__.ahead = 2;
  });
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Refresh", exact: true }).click();
  const push = app.getByTestId("git-primary-push");
  await expect(push).toHaveText("Push to backup");
  await app.evaluate(() => {
    (window as any).__PRIMARY_FAIL__ = true;
  });
  await push.click();
  await expect(app.getByTestId("git-panel")).toContainText("Push rejected by remote");
  await expect(push).toBeEnabled();
  await expect(app.getByTestId("git-file-row")).toHaveCount(2);
});

test("without upstream, committed changes offer explicit publication", async ({ app }) => {
  await setup(app, false);
  await app.getByTestId("git-stage-all").click();
  await app.getByTestId("git-commit-message").fill("initial commit");
  await app.getByTestId("git-commit-btn").click();
  const publish = app.getByTestId("git-primary-push");
  await expect(publish).toHaveText("Publish branch to origin");
  await publish.click();
  const root = await app.evaluate(
    () => (window as any).__PRIMARY_CALLS__.find((c: any) => c.cmd === "git_commit").args.root,
  );
  await expect
    .poll(() =>
      app.evaluate(() =>
        (window as any).__PRIMARY_CALLS__
          .filter((c: any) => c.cmd === "git_sync")
          .map((c: any) => c.args),
      ),
    )
    .toEqual([{ root, action: "publish", remote: "origin" }]);
  await expect(app.getByTestId("git-commit-btn")).toBeDisabled();
});

test("failed commit retains selection and draft, and never offers push", async ({ app }) => {
  await setup(app);
  await app.getByTestId("git-stage-all").click();
  await app.getByTestId("git-commit-message").fill("keep my draft");
  await app.evaluate(() => {
    (window as any).__PRIMARY_FAIL__ = true;
  });
  await app.getByTestId("git-commit-btn").click();
  await expect(app.getByTestId("git-commit-box")).toContainText("Hook rejected commit");
  await expect(app.getByTestId("git-commit-message")).toHaveValue("keep my draft");
  await expect(app.getByRole("checkbox", { name: "Unstage", exact: true })).toHaveCount(2);
  await expect(app.getByTestId("git-primary-push")).toHaveCount(0);
  await expect(app.getByTestId("git-commit-btn")).toBeEnabled();
});

test("remote menus survive a failed status read", async ({ app }) => {
  await setup(app);
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) =>
      cmd === "git_remote_status"
        ? Promise.reject("Upstream reference unavailable")
        : original(cmd, args);
  });
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Refresh", exact: true }).click();
  await expect(app.getByTestId("git-panel")).toContainText("Upstream reference unavailable");
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await expect(app.getByRole("menuitem", { name: "Push", exact: true })).toBeVisible();
  await app.keyboard.press("Escape");
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await expect(app.getByRole("menuitem", { name: "Fetch", exact: true })).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(app.getByTestId("git-primary-push")).toHaveCount(0);
});
