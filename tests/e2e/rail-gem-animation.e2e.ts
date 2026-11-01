import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

test("the selected rail gem rotates in a visible unfocused document", async ({
  app,
  browser,
  screen,
}) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) {
      return;
    }
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    localStorage.setItem("sidebar-collapsed", "true");
    localStorage.setItem("gem-display", JSON.stringify({ frozen: false, forceMotion: true }));
    Object.defineProperty(document, "hasFocus", { value: () => false });
  });
  await app.open();
  await expect(screen.getByTestId("sidebar-collapsed")).toBeVisible();
  const mesh = () =>
    browser.evaluate(
      () =>
        document.querySelector('[data-testid^="rail-project-"][aria-current="true"] svg')!
          .innerHTML,
    );
  const before = await mesh();
  await expect.poll(mesh).not.toBe(before);
  await app.screenshot("rail-gem-rotating-before");
  await browser.evaluate(() => window.dispatchEvent(new Event("blur")));
  const blurred = await mesh();
  await expect.poll(mesh).not.toBe(blurred);
  await app.screenshot("rail-gem-rotating-after");
});
