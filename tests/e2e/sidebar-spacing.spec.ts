import { test, expect } from "./fixtures";

test("commit subjects are not vertically clipped", async ({ app }) => {
  await app.getByTestId("sidebar-git-toggle").click();
  await app.getByRole("tab", { name: "History", exact: true }).click();
  const row = app.getByTestId("git-commit-row").first();
  await expect(row).toBeVisible();
  const clipped = await row
    .locator("span")
    .first()
    .evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(clipped).toBe(false);
  await app.getByTestId("git-history").screenshot({ path: "logs/e2e/git-history-spacing.png" });
});

test("the first terminal sits close to project modules", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  const modules = app.getByRole("group", { name: "Project modules" });
  const first = app.locator('[data-testid="project-terminals"] [data-testid^="term-"]').first();
  const top = await modules.boundingBox();
  const bottom = await first.boundingBox();
  expect(bottom!.y - (top!.y + top!.height)).toBeLessThanOrEqual(8);
  await app.getByTestId("sidebar").screenshot({ path: "logs/e2e/sidebar-spacing.png" });
});
