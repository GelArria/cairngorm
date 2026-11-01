import { test, expect } from "./fixtures";

test("gemstone themes are searchable and apply", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.getByTestId("header-settings").click();
  await app.getByRole("button", { name: "Themes & colors", exact: true }).click();
  const panel = app.getByTestId("appearance-settings");
  await expect(panel.getByRole("button", { name: "Gems", exact: true })).toHaveCount(0);
  await app.getByLabel("Search themes").fill("phospho");
  await panel.getByTestId("theme-phosphophyllite").click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "phosphophyllite");
  await app.getByLabel("Search themes").fill("cinnabar");
  await panel.getByTestId("theme-cinnabar").click();
  await expect(app.locator("html")).toHaveAttribute("data-theme", "cinnabar");
  await app.takeScreenshot("appearance-gems-cinnabar");
});
