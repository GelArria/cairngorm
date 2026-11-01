import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

test("empty workspace project gem rotates and respects freeze", async ({
  app,
  browser,
  screen,
}) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (location.protocol.startsWith("http")) {
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("gem-display", JSON.stringify({ forceMotion: true }));
    }
  });
  await app.open();
  await expect(screen.getByTestId("terminal-empty")).toBeVisible();
  const changesPose = () =>
    browser.evaluate(async () => {
      const svg = document.querySelector('[data-testid="terminal-empty"] .project-gem')!;
      const before = svg.innerHTML;
      for (let frame = 0; frame < 8; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return svg.innerHTML !== before;
    });
  expect(await changesPose()).toBe(true);
  await app.screenshot("empty-project-gem-rotating");
  await browser.evaluate(() => {
    localStorage.setItem("gem-display", JSON.stringify({ frozen: true }));
    window.dispatchEvent(new StorageEvent("storage", { key: "gem-display" }));
  });
  // Let the preference subscription commit before sampling the frozen geometry.
  await browser.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  expect(await changesPose()).toBe(false);
});
