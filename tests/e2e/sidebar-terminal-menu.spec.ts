import { test, expect } from "./fixtures";

test("workspace background menu creates a terminal", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.getByTestId("project-terminals").click({ button: "right" });
  await expect(app.getByRole("menuitem", { name: "New Conversation", exact: true })).toHaveCount(0);
  await expect(app.getByRole("menuitem", { name: "Open", exact: true })).toBeVisible();
  await app.screenshot({ path: "logs/e2e/sidebar-terminal-menu.png" });
  await app.getByRole("menuitem", { name: "New Terminal", exact: true }).click();
  await expect(
    app.locator('[data-testid="project-terminals"] [data-testid^="term-"]').first(),
  ).toBeVisible();
});
