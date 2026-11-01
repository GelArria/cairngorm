import { test, expect } from "./fixtures";

test.beforeEach(async ({ app }) => {
  await app.evaluate(() => {
    localStorage.setItem("show-splash", "false");
    const internal = (window as any).__TAURI_INTERNALS__,
      original = internal.invoke;
    let branch = "main";
    const branches = ["main", "develop", "feature/checkout", "blocked"];
    internal.invoke = async (cmd: string, args: any) => {
      if (cmd === "git_branch") return branch;
      if (cmd === "git_branches") return branches;
      if (cmd === "git_switch") {
        if (args.branch === "blocked")
          throw new Error("Your local changes would be overwritten by checkout");
        if (args.create) branches.push(args.branch);
        branch = args.branch;
        return;
      }
      return original(cmd, args);
    };
  });
  await app.evaluate(async () => {
    const url = "/src/git/hooks/use-git-status.ts";
    await (await import(/* @vite-ignore */ url)).refreshGit(true);
  });
});

// Branches switch from the Git panel; the sidebar header only names the project.
async function gitPanel(app: import("@playwright/test").Page) {
  await app.getByTestId("sidebar-git-toggle").click();
  const panel = app.getByTestId("git-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test("switches and creates branches from the Git panel", async ({ app }) => {
  const panel = await gitPanel(app);
  await expect(panel.getByTestId("git-branch")).toHaveText("main");
  await panel.getByRole("button", { name: "Switch branch", exact: true }).click();
  await app.getByLabel("Filter branches").fill("feature");
  await app.evaluate(async () => {
    const url = "/src/git/hooks/use-git-status.ts";
    await (await import(/* @vite-ignore */ url)).refreshGit(true);
  });
  await expect(app.getByLabel("Filter branches")).toHaveValue("feature");
  await expect(app.getByRole("menuitemradio")).toHaveCount(1);
  await app.takeScreenshot("project-direct-branch-selector");
  await app.getByRole("menuitemradio", { name: "feature/checkout", exact: true }).click();
  await expect(panel.getByTestId("git-branch")).toHaveText("feature/checkout");
  await panel.getByRole("button", { name: "Switch branch", exact: true }).focus();
  await app.keyboard.press("Enter");
  await app.getByRole("menuitem", { name: "Create branch…", exact: true }).click();
  await app.getByLabel("Branch name").fill("feature/new-ui");
  await app.getByRole("button", { name: "Create", exact: true }).click();
  await expect(panel.getByTestId("git-branch")).toHaveText("feature/new-ui");
});

test("shows checkout errors and keeps the current branch", async ({ app }) => {
  const panel = await gitPanel(app);
  await panel.getByRole("button", { name: "Switch branch", exact: true }).click();
  await app.getByRole("menuitemradio", { name: "blocked", exact: true }).click();
  await expect(app.getByRole("alert")).toContainText("local changes would be overwritten");
  await expect(panel.getByTestId("git-branch")).toHaveText("main");
  await app.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(app.getByRole("alert")).toHaveCount(0);
});
