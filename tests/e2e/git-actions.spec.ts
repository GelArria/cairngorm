import { test, expect } from "./fixtures";

async function openGit(app: import("@playwright/test").Page) {
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__GIT_ACTIONS__ = [];
    let branch = "main";
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      w.__GIT_ACTIONS__.push({ cmd, args });
      if (cmd === "git_branches")
        return Promise.resolve(["main", "feature", "origin/remote-feature"]);
      if (cmd === "git_branch") return Promise.resolve(branch);
      if (cmd === "git_switch") {
        branch = args.branch;
        return Promise.resolve(null);
      }
      if (cmd === "git_summarize") return Promise.resolve("feat: summarize staged changes");
      if (cmd === "git_commit_action") return Promise.resolve(null);
      return original(cmd, args);
    };
  });
  await app.locator('[data-testid="sidebar-git-toggle"]').click();
}

test("AI summary is visible, fills an editable compact message and follows commit mode", async ({
  app,
}) => {
  await openGit(app);
  const message = app.getByTestId("git-commit-message");
  expect((await message.boundingBox())!.height).toBeLessThanOrEqual(40);
  await app
    .getByTestId("git-panel")
    .screenshot({ path: "logs/e2e/git-actions-compact.png", animations: "disabled" });
  await app.getByRole("button", { name: "AI summarize", exact: true }).click();
  await expect(message).toHaveValue("feat: summarize staged changes");
  expect(
    await app.evaluate(
      () => (window as any).__GIT_ACTIONS__.find((a: any) => a.cmd === "git_summarize").args.mode,
    ),
  ).toBe("staged");
  await message.fill(
    "subject\n\nA longer description\nthat should grow\nwithout overflowing\nthe sidebar",
  );
  expect((await message.boundingBox())!.height).toBeGreaterThan(40);
  await app
    .getByTestId("git-panel")
    .screenshot({ path: "logs/e2e/git-actions-expanded.png", animations: "disabled" });
  await app.getByRole("button", { name: "Commit options", exact: true }).click();
  await app.getByRole("menuitemradio", { name: "Commit All", exact: true }).click();
  await app.getByRole("button", { name: "AI summarize", exact: true }).click();
  await app.getByRole("button", { name: "Summarize", exact: true }).click();
  await expect(message).toHaveValue("feat: summarize staged changes");
  expect(
    await app.evaluate(
      () =>
        (window as any).__GIT_ACTIONS__.filter((a: any) => a.cmd === "git_summarize").at(-1).args
          .mode,
    ),
  ).toBe("all");
  await app
    .getByTestId("sidebar")
    .screenshot({ path: "logs/e2e/git-actions-summary.png", animations: "disabled" });
});

test("branch switching, create, push/fetch and history actions invoke the backend", async ({
  app,
}) => {
  await openGit(app);
  await app.getByTestId("git-commit-message").fill("draft to keep");
  await app
    .getByTestId("git-panel")
    .getByRole("button", { name: "Switch branch", exact: true })
    .click();
  await app.getByRole("menuitemradio", { name: "feature", exact: true }).click();
  await expect(app.getByTestId("git-branch")).toHaveText("feature");
  await expect(app.getByTestId("git-commit-message")).toHaveValue("draft to keep");
  await app
    .getByTestId("git-panel")
    .getByRole("button", { name: "Switch branch", exact: true })
    .click();
  await app.getByRole("menuitem", { name: "Create branch…", exact: true }).click();
  await app.getByLabel("Branch name").fill("new-feature");
  await app.getByRole("button", { name: "Create", exact: true }).click();
  await expect(app.getByTestId("git-branch")).toHaveText("new-feature");
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByTestId("git-push").click();
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Fetch", exact: true }).click();
  await app.getByRole("tab", { name: "History", exact: true }).click();
  await app.getByTestId("git-commit-row").first().click({ button: "right" });
  await app.getByRole("menuitem", { name: "Cherry-pick…", exact: true }).click();
  await app.getByRole("button", { name: "Cherry-pick", exact: true }).click();
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (window as any).__GIT_ACTIONS__.filter((a: any) => a.cmd === "git_commit_action").length,
      ),
    )
    .toBe(1);
  const actions = await app.evaluate(() => (window as any).__GIT_ACTIONS__);
  const root = actions.find((a: any) => a.cmd === "git_status").args.root;
  expect(actions).toEqual(
    expect.arrayContaining([
      { cmd: "git_switch", args: { root, branch: "new-feature", create: true } },
      { cmd: "git_sync", args: { root, action: "push-upstream", remote: "origin" } },
      { cmd: "git_sync", args: { root, action: "fetch" } },
      { cmd: "git_commit_action", args: { root, action: "cherry-pick", hash: "abc1234" } },
    ]),
  );
});

test("narrow sidebar keeps branch and commit controls inside the panel", async ({ app }) => {
  await openGit(app);
  await app.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('[data-testid="sidebar"]')!;
    Object.assign(sidebar.style, { width: "264px", minWidth: "264px", maxWidth: "264px" });
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) =>
      cmd === "git_branch" ? Promise.resolve("feat/doop-v2-design-and-more") : original(cmd, args);
  });
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Refresh", exact: true }).click();
  await expect(app.getByTestId("git-branch")).toHaveText("feat/doop-v2-design-and-more");
  const branch = await app
    .getByTestId("git-panel")
    .getByRole("button", { name: "Switch branch", exact: true })
    .boundingBox();
  const actions = await app.getByRole("button", { name: "Git actions", exact: true }).boundingBox();
  expect(branch!.x + branch!.width).toBeLessThanOrEqual(actions!.x);
  await app
    .getByTestId("git-commit-message")
    .fill(
      "A long commit subject that wraps naturally when the sidebar gets narrower, then stops growing at a bounded height.\n".repeat(
        6,
      ),
    );
  const size = await app.getByTestId("git-commit-message").boundingBox();
  expect(size!.height).toBeLessThanOrEqual(120);
  const overflow = await app.getByTestId("git-panel").evaluate((el) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll("button, textarea")].some((c) => {
      const r = c.getBoundingClientRect();
      return r.right > box.right + 1 || r.left < box.left - 1;
    });
  });
  expect(overflow).toBe(false);
  await app.getByTestId("git-commit-message").fill("");
  await app
    .getByTestId("git-panel")
    .screenshot({ path: "logs/e2e/git-actions-narrow.png", animations: "disabled" });
});

test("AI failure and late replies preserve the user's draft", async ({ app }) => {
  await openGit(app);
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) =>
      cmd === "git_summarize"
        ? new Promise((resolve) => {
            w.__RESOLVE_SUMMARY__ = resolve;
          })
        : original(cmd, args);
  });
  await app.getByRole("button", { name: "AI summarize", exact: true }).click();
  await expect
    .poll(() => app.evaluate(() => typeof (window as any).__RESOLVE_SUMMARY__))
    .toBe("function");
  await app.getByTestId("git-commit-message").fill("my own message");
  await app.evaluate(() => (window as any).__RESOLVE_SUMMARY__("late response"));
  await expect(app.getByRole("button", { name: "AI summarize", exact: true })).toBeEnabled();
  await expect(app.getByTestId("git-commit-message")).toHaveValue("my own message");
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) =>
      cmd === "git_summarize"
        ? Promise.reject("Configure an AI provider in Settings → AI providers.")
        : original(cmd, args);
  });
  await app.getByRole("button", { name: "AI summarize", exact: true }).click();
  await app.getByRole("button", { name: "Summarize", exact: true }).click();
  await expect(app.getByText("Configure an AI provider in Settings → AI providers.")).toBeVisible();
  await expect(app.getByTestId("git-commit-message")).toHaveValue("my own message");
});
