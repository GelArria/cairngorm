import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function setup(app: Page) {
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__GIT_UI_CALLS__ = [];
    w.__GIT_UI_LOG__ = Array.from({ length: 110 }, (_, i) => ({
      hash: (i + 1).toString(16).padStart(7, "0"),
      author: i % 3 === 0 ? "Morgan" : "Alex",
      time: "1 day ago",
      at: Math.floor(Date.now() / 1000) - i * 3600,
      subject:
        i === 0
          ? "Merge feature: searchable Git workspace"
          : i === 1
            ? "feat: align before and after diffs"
            : i === 2
              ? "fix: keep branch status visible"
              : `chore: repository update ${i}`,
      parents:
        i === 0
          ? ["0000002", "0000003"]
          : i < 109
            ? [(i === 1 ? 4 : i + 2).toString(16).padStart(7, "0")]
            : [],
      refs: i === 0 ? ["HEAD -> main", "origin/main"] : i === 2 ? ["feature/git-ui"] : [],
    }));
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) => {
      w.__GIT_UI_CALLS__.push({ cmd, args });
      if (cmd === "git_branches") return Promise.resolve(["main", "feature/git-ui"]);
      if (cmd === "git_log")
        return Promise.resolve(w.__GIT_UI_LOG__.slice(args.skip ?? 0, (args.skip ?? 0) + args.max));
      if (cmd === "git_remotes") return Promise.resolve(["origin", "backup"]);
      if (cmd === "git_status")
        return Promise.resolve({
          files: [
            { path: "src/git/bridge.ts", code: "MM" },
            { path: "src/git/history.tsx", code: " M" },
            { path: "tests/new.test.ts", code: "??" },
            { path: "README.md", code: "M " },
          ],
          error: null,
        });
      if (cmd === "git_commit_details") {
        const commit = w.__GIT_UI_LOG__.find((c: any) => args.hash.startsWith(c.hash))!;
        return Promise.resolve({
          hash: commit.hash.padEnd(40, "0"),
          author: commit.author,
          email: "dev@example.invalid",
          date: "2026-10-05T12:00:00Z",
          refs: commit.refs,
          parents: ["b".repeat(40)],
          githubUrl: `https://github.com/example/git-ui/commit/${commit.hash.padEnd(40, "0")}`,
          message: `${commit.subject}\n\nKeep History compact and put topology in the workspace.\n\nFiles open immutable historical diffs; the index is never changed.`,
          files: [
            { path: "src/git/bridge.ts", status: "M", added: 3, removed: 2 },
            { path: "src/git/history.tsx", status: "M", added: 2, removed: 1 },
            { path: "tests/graph.test.ts", status: "A", added: 8, removed: 0 },
          ],
        });
      }
      if (cmd === "git_commit_diff")
        return Promise.resolve(
          `diff --git a/${args.path} b/${args.path}\n--- a/${args.path}\n+++ b/${args.path}\n@@ -1,5 +1,6 @@\n export function history() {\n-  const title = "Recent commits";\n-  return graph(title);\n+  const title = "History";\n+  const commits = readHistory();\n+  return flatList(commits);\n }\n // end\n`,
        );
      return original(cmd, args);
    };
  });
  await app.getByTestId("git-footer").click();
}

test("persistent footer, flat History and separate paginated searchable Graph with inspector", async ({
  app,
}) => {
  await setup(app);
  const footer = app.getByTestId("git-footer");
  await expect(footer).toContainText("main");
  await expect(footer).toContainText("4 Δ");
  await app.getByRole("tab", { name: "History", exact: true }).click();
  const history = app.getByTestId("git-history");
  await expect(history.getByTestId("git-commit-row")).toHaveCount(100);
  await expect(history.locator("svg")).toHaveCount(0);
  await expect(history).not.toContainText("Recent commits");
  await expect(history.getByTestId("git-commit-row").first()).toContainText("Morgan");
  await app
    .getByTestId("sidebar")
    .screenshot({ path: "logs/e2e/git-ui-flat-history-footer.png", animations: "disabled" });
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Open Git Graph", exact: true }).click();
  const graph = app.getByTestId("git-graph-view");
  await expect(graph.getByTestId("git-graph-row")).toHaveCount(100);
  await expect(graph.getByTestId("git-graph-cell").first().locator("path")).toHaveCount(1);
  await expect(graph.getByRole("complementary")).toContainText("Keep History compact");
  await expect(graph.getByRole("button", { name: "View on GitHub", exact: true })).toBeVisible();
  await graph.getByRole("button", { name: "Load older commits" }).click();
  await expect(graph.getByTestId("git-graph-row")).toHaveCount(110);
  await app.getByLabel("Search commits", { exact: true }).fill("keep branch");
  await expect(graph).toContainText("1 matches");
  await graph.getByRole("button", { name: "Next matching commit" }).click();
  await expect(graph.getByRole("complementary")).toContainText("fix: keep branch status visible");
  await expect(graph.getByTestId("git-graph-row")).toHaveCount(110); // preserve actual lanes during search
  await app.getByLabel("Search commits", { exact: true }).fill("");
  await graph
    .getByTestId("git-graph-row")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "nearest" }));
  await graph.getByTestId("git-graph-row").first().click();
  await expect(graph.getByRole("complementary")).toContainText("Merge feature");
  await app.screenshot({ path: "logs/e2e/git-ui-graph-inspector.png", animations: "disabled" });
  await graph.getByTestId("git-commit-file").filter({ hasText: "history.tsx" }).click();
  const detail = app.getByTestId("git-commit-detail").filter({ has: app.getByTestId("diff-view") });
  await expect(detail).toBeVisible();
  await expect(
    detail.getByTestId("git-commit-file").filter({ hasText: "history.tsx" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByTestId("diff-before").filter({ hasText: "Recent commits" })).toHaveCount(
    1,
  );
  await expect(detail.getByTestId("diff-after").filter({ hasText: "flatList" })).toHaveCount(1);
  await detail.getByRole("button", { name: "Unified", exact: true }).click();
  await expect(detail.getByTestId("diff-split-row")).toHaveCount(0);
  await detail.getByRole("button", { name: "Side by side", exact: true }).click();
  await app.screenshot({ path: "logs/e2e/git-ui-side-by-side.png", animations: "disabled" });
});

test("changes view supports tree, name/path sorting and both grouping modes without losing partial staging", async ({
  app,
}) => {
  await setup(app);
  const options = () => app.getByRole("button", { name: "Git actions", exact: true }).click();
  await expect(app.getByTestId("git-file-row")).toHaveCount(5);
  await options();
  await app.getByRole("menuitemcheckbox", { name: "Show as tree", exact: true }).click();
  await expect(app.getByTestId("git-path-folder").first()).toBeVisible();
  await options();
  await app.getByRole("menuitemradio", { name: "Group: tracked & untracked", exact: true }).click();
  await expect(app.getByTestId("git-panel")).toContainText("Tracked (4)");
  await expect(app.getByTestId("git-panel")).toContainText("Untracked (1)");
  await expect(app.getByTestId("git-file-row")).toHaveCount(5);
  await app
    .getByTestId("sidebar")
    .screenshot({ path: "logs/e2e/git-ui-changes-tree.png", animations: "disabled" });
  await options();
  await app.getByRole("menuitemradio", { name: "No grouping", exact: true }).click();
  await options();
  await app.getByRole("menuitemcheckbox", { name: "Show as tree", exact: true }).click();
  await options();
  await app.getByRole("menuitemcheckbox", { name: "Sort by file name", exact: true }).click();
  await expect(app.getByTestId("git-file-row").first()).toContainText("bridge.ts");
  await options();
  await app.getByRole("menuitemcheckbox", { name: "Sort by file name", exact: true }).click();
  await expect(app.getByTestId("git-file-row").first()).toContainText("README.md");
});

test("footer reports a lower bound when the status list reaches its backend cap", async ({
  app,
}) => {
  await setup(app);
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    const actualFiles = Array.from({ length: 501 }, (_, i) => ({
      path: `new-${i}.txt`,
      code: "??",
    }));
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: any) =>
      cmd === "git_status"
        ? Promise.resolve({ files: actualFiles.slice(0, 500), error: null })
        : original(cmd, args);
  });
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Refresh", exact: true }).click();
  const footer = app.getByTestId("git-footer");
  await expect(footer).toContainText("≥500 Δ");
  await expect(footer).toHaveAccessibleName(
    "Open Git: main, at least 500 changed files (display limit)",
  );
  await footer.hover();
  await expect(app.getByRole("tooltip")).toContainText(
    "Open Git · at least 500 changed files (display limit)",
  );
  await footer.screenshot({ path: "logs/e2e/git-ui-footer-capped.png", animations: "disabled" });
});

test("Graph stacks its inspector in a narrow workspace and unsupported GitHub links stay hidden", async ({
  app,
}) => {
  await setup(app);
  await app.setViewportSize({ width: 1024, height: 768 });
  await app.evaluate(() => {
    const w = window as any,
      original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      const value = await original(cmd, args);
      return cmd === "git_commit_details" ? { ...value, githubUrl: null } : value;
    };
  });
  await app.getByRole("button", { name: "Git actions", exact: true }).click();
  await app.getByRole("menuitem", { name: "Open Git Graph", exact: true }).click();
  const graph = app.getByTestId("git-graph-view");
  await expect(graph.getByRole("complementary")).toContainText("Merge feature");
  await expect(graph.getByRole("button", { name: "View on GitHub", exact: true })).toHaveCount(0);
  const table = await graph.getByLabel("Commit graph table").boundingBox();
  const inspector = await graph.getByRole("complementary").boundingBox();
  expect(inspector!.y).toBeGreaterThanOrEqual(table!.y + table!.height - 1);
  expect(await graph.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await graph.getByTestId("git-commit-file").last().scrollIntoViewIfNeeded();
  await expect(graph.getByTestId("git-commit-file").last()).toBeInViewport();
  await graph.getByTestId("git-commit-file").last().click();
  const detail = app.getByTestId("git-commit-detail").filter({ has: app.getByTestId("diff-view") });
  await expect(
    detail.getByTestId("git-commit-file").filter({ hasText: "graph.test.ts" }),
  ).toHaveAttribute("aria-pressed", "true");
  await app
    .getByRole("tab", { name: /Git Graph/ })
    .first()
    .click();
  await app.screenshot({ path: "logs/e2e/git-ui-graph-narrow.png", animations: "disabled" });
});

test("commit and remote options require explicit opt-in and guarded destructive actions", async ({
  app,
}) => {
  await setup(app);
  const pullMenu = () => app.getByRole("button", { name: "Git actions", exact: true }).click();
  const pushMenu = () => app.getByRole("button", { name: "Git actions", exact: true }).click();
  await pullMenu();
  await app.getByRole("menuitem", { name: "Fetch from backup", exact: true }).click();
  await pushMenu();
  await app.getByRole("menuitem", { name: "Push to backup", exact: true }).click();
  await pushMenu();
  await app.getByRole("menuitem", { name: "Force push with lease…", exact: true }).click();
  await expect(app.getByRole("dialog")).toContainText("rejected if the remote moved");
  expect(
    await app.evaluate(() =>
      (window as any).__GIT_UI_CALLS__.some((c: any) => c.args?.action === "force-push"),
    ),
  ).toBe(false);
  await app.getByRole("button", { name: "Cancel", exact: true }).click();
  await pushMenu();
  await app.getByRole("menuitem", { name: "Force push with lease…", exact: true }).click();
  await app.getByRole("button", { name: "Force push with lease", exact: true }).click();
  await pullMenu();
  await app.getByRole("menuitem", { name: "Pull with rebase…", exact: true }).click();
  await app.getByRole("button", { name: "Pull Rebase", exact: true }).click();
  await app.getByTestId("git-commit-message").fill("feat: explicit options");
  for (const label of ["Amend", "Signoff", "Skip Hooks"]) {
    await app.getByRole("button", { name: "Commit options", exact: true }).click();
    await app.getByRole("menuitemcheckbox", { name: label, exact: true }).click();
  }
  await app.getByTestId("git-commit-message").press("Enter");
  await expect(app.getByRole("dialog")).toContainText("Amend replaces the latest commit");
  await expect(app.getByRole("dialog")).toContainText("bypasses pre-commit");
  await app.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(app.getByTestId("git-commit-message")).toHaveValue("");
  const calls = await app.evaluate(() => (window as any).__GIT_UI_CALLS__);
  const root = calls.find((c: any) => c.cmd === "git_status").args.root;
  expect(calls.filter((c: any) => c.cmd === "git_sync").map((c: any) => c.args)).toEqual(
    expect.arrayContaining([
      { root, action: "fetch", remote: "backup" },
      { root, action: "push", remote: "backup" },
      { root, action: "force-push" },
      { root, action: "pull-rebase" },
    ]),
  );
  expect(calls.find((c: any) => c.cmd === "git_commit").args.options).toEqual({
    amend: true,
    signoff: true,
    skipHooks: true,
  });
});
