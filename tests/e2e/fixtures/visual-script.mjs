// Covers ESM imports of playwright-core and direct browser.close(), without runner output.
import { chromium } from "playwright-core";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(process.env.CAIRNGORM_FIXTURE_URL);
await page.getByRole("button", { name: "Add to bag" }).click();
await page.getByRole("button", { name: "Checkout · 1 item" }).click();
await page.getByRole("textbox", { name: "Email" }).fill("script@example.test");
await page.evaluate(() => {
  window.caretMutations = 0;
  new MutationObserver((records) => {
    window.caretMutations += records.length;
  }).observe(document.querySelector("input"), { attributes: true, attributeFilter: ["style"] });
});
await page.waitForTimeout(700);
if (await page.evaluate(() => window.caretMutations))
  throw new Error("Live capture mutated input styles");
await browser.close();
