import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

for (const side of ["top", "bottom"] as const) {
  test(`the ${side} dock gem rotates without interaction and respects freeze`, async ({
    app,
    browser,
    screen,
  }) => {
    await browser.addInitScript(SEED_INIT);
    await browser.addInitScript((side) => {
      if (!location.protocol.startsWith("http")) {
        return;
      }
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("sidebar-side", side);
      localStorage.setItem("gem-display", JSON.stringify({ frozen: false, forceMotion: true }));
    }, side);
    await app.open();
    const picker = screen.getByTestId("dock-project-picker");
    await expect(picker).toBeVisible();
    const mesh = () =>
      browser.evaluate(
        () => document.querySelector('[data-testid="dock-project-picker"] svg')!.innerHTML,
      );
    const still = (frames: number) =>
      browser.evaluate(async (frames) => {
        const svg = document.querySelector('[data-testid="dock-project-picker"] svg')!;
        const mesh = svg.innerHTML;
        for (let i = 0; i < frames; i++) {
          await new Promise(requestAnimationFrame);
          if (svg.innerHTML !== mesh) return false;
        }
        return true;
      }, frames);
    const first = await mesh();
    await expect.poll(mesh).not.toBe(first);
    await app.screenshot(`dock-gem-${side}-rotating`);

    await browser.evaluate(() => {
      localStorage.setItem("gem-display", JSON.stringify({ frozen: true, forceMotion: true }));
      window.dispatchEvent(new StorageEvent("storage", { key: "gem-display" }));
    });
    const frozen = await mesh();
    await expect.poll(mesh, { timeout: 1200 }).toBe(frozen);
    // Sample across several animation frames rather than only at one instant.
    expect(await still(8)).toBe(true);
    await browser.evaluate(() => {
      localStorage.setItem("gem-display", JSON.stringify({ frozen: false, forceMotion: true }));
      window.dispatchEvent(new StorageEvent("storage", { key: "gem-display" }));
    });
    await expect.poll(mesh).not.toBe(frozen);
    await app.screenshot(`dock-gem-${side}-resumed`);
  });
}
