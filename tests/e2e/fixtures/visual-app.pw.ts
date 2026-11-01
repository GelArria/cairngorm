import { test, expect } from "@playwright/test";

test("customer buys a notebook", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Field Notes" })).toBeVisible();
  await page.getByRole("button", { name: "Add to bag" }).click();
  await expect(page.getByRole("button", { name: "Checkout · 1 item" })).toBeVisible();
  await page.waitForTimeout(900); // Gives the live-view assertion an observable intermediate state.
  await page.getByRole("button", { name: "Checkout · 1 item" }).click();
  await page.getByRole("textbox", { name: "Email" }).fill("customer@example.test");
  await page.waitForTimeout(2000); // Keep the live action observable while Cairngorm controls are exercised.
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await page.waitForTimeout(1600);
});
