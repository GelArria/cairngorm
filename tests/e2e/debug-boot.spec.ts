// Debug spec: mirrors the fixture but captures screenshot + console errors on failure.
import { test, expect } from "@playwright/test";

test("debug: app boot", async ({ page }) => {
  const errs: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 300)));
  page.on("response", (r) => {
    if (r.status() === 404) errs.push("404: " + r.url());
  });
  page.on("requestfailed", (r) =>
    errs.push("REQFAIL: " + r.url() + " " + (r.failure()?.errorText ?? "")),
  );
  const t0 = Date.now();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  let ok = false;
  for (let i = 0; i < 40; i++) {
    ok = await page.evaluate(() => !!document.querySelector('[data-testid="sidebar"]'));
    if (ok) break;
    await page.waitForTimeout(500);
  }
  console.log(`sidebar tras ${Date.now() - t0}ms: ${ok}`);
  console.log("errores:", errs.length ? "" : "ninguno");
  errs.slice(0, 8).forEach((e) => console.log("  ERR:", e));
  await page.screenshot({ path: "logs/e2e/debug-boot-e2e.png", fullPage: false });
  expect(ok, "the sidebar must appear").toBe(true);
});
