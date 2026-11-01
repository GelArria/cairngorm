import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

for (const mode of ["light", "dark"] as const) {
  test(`search modes remain distinct and toggle their real state in ${mode} mode`, async ({
    app,
    browser,
    screen,
  }) => {
    await browser.addInitScript(SEED_INIT);
    await browser.addInitScript(() => {
      if (!location.protocol.startsWith("http")) return;
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("sidebar-side", "left");
      localStorage.setItem("gem-display", JSON.stringify({ frozen: true }));
    });
    await app.open();
    await expect(screen.getByTestId("sidebar")).toBeVisible({ timeout: 30000 });
    await browser.evaluate(async (mode) => {
      const url = "/src/appearance/data/store.ts";
      const appearance = await import(/* @vite-ignore */ url);
      appearance.selectTheme(mode === "light" ? "white" : "cairngorm");
      appearance.setAppearance({ mode });
    }, mode);
    await expect
      .poll(() => browser.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(mode === "dark");
    await screen.getByTestId("sidebar-files-toggle").tap();
    await screen.getByRole("button", "Search in files").tap();
    await expect(screen.getByTestId("search-in-files-input")).toBeVisible();
    await expect(screen.getByRole("button", "Search in files")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const label of ["Aa", "ab", ".*"]) {
      const toggle = screen.getByRole("button", label, { exact: true });
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      const colors = () =>
        browser.evaluate((label) => {
          const button = [...document.querySelectorAll("button")].find(
            (element) => element.textContent?.trim() === label,
          )!;
          const style = getComputedStyle(button);
          return { background: style.backgroundColor, text: style.color };
        }, label);
      const off = await colors();
      await toggle.tap();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect.poll(colors).not.toEqual(off);
      const on = await colors();
      expect(on.background).not.toBe(on.text);
    }
    expect(
      await browser.evaluate(async () => {
        const url = "/src/search/data/search-store.ts";
        const { getState } = await import(/* @vite-ignore */ url);
        const { caseSensitive, wholeWord, useRegex } = getState();
        return { caseSensitive, wholeWord, useRegex };
      }),
    ).toEqual({ caseSensitive: true, wholeWord: true, useRegex: true });
    await browser.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await app.screenshot(`search-modes-${mode}`);
    for (const label of ["Aa", "ab", ".*"]) {
      const toggle = screen.getByRole("button", label, { exact: true });
      await toggle.tap();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
    }
    await screen.getByTestId("search-in-files-input").press("Escape");
    await expect(screen.getByTestId("search-in-files-input")).toBeHidden();
    await expect(screen.getByRole("button", "Search in files")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
}
