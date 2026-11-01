import { test, expect, setPaneView } from "./fixtures";

test("production transcript clicks focus the composer without browser errors", async ({ app }) => {
  const errors: string[] = [];
  app.on("pageerror", (error) => errors.push(error.message));
  await setPaneView(app, "Show Chat UI");
  const input = app.getByPlaceholder("Type a message…");
  await expect(input).toBeVisible();
  await input.evaluate((el) => el.blur());
  await expect(input).not.toBeFocused();
  await app.getByText("Waiting for agent events…", { exact: true }).click();
  await expect(input).toBeFocused();
  await app.keyboard.type("focus regression");
  await expect(input).toHaveValue("focus regression");
  expect(errors).toEqual([]);
});
