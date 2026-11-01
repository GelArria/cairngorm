import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

test("transparency priority selects independent levels and persists across reloads", async ({
  app,
  browser,
  screen,
}) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    if (!localStorage.getItem("cairngorm-transparency")) {
      localStorage.setItem(
        "cairngorm-transparency",
        JSON.stringify({
          enabled: true,
          material: "clear",
          overall: 100,
          surfaces: { sidebar: 40 },
        }),
      );
    }
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  const sidebarAlpha = () =>
    browser.evaluate(
      () => getComputedStyle(document.querySelector(".surface-sidebar")!).backgroundColor,
    );
  await expect.poll(sidebarAlpha).toMatch(/rgba\(.+, 0\.4\)/);
  await browser.keyboard.press("Control+Comma");
  const dialog = screen.getByTestId("settings-dialog");
  await dialog.getByRole("button", "Transparency").tap();
  const priority = dialog.getByRole("radiogroup", "Transparency priority");
  const global = priority.getByRole("radio", "Global");
  const parts = priority.getByRole("radio", "By part");
  const overall = dialog.getByRole("slider", "Global opacity");
  const sidebar = dialog.getByRole("slider", "Sidebar");
  await expect(parts).toBeChecked();
  await expect(overall).toBeDisabled();
  await expect(sidebar).toBeEnabled();
  await app.screenshot("transparency-by-part");

  await global.tap();
  await expect(global).toBeChecked();
  await expect(overall).toBeEnabled();
  await expect(sidebar).toBeDisabled();
  await expect.poll(sidebarAlpha).toMatch(/^rgb\(/);
  await overall.press("Home");
  await expect(overall).toHaveValue("10");
  await expect.poll(sidebarAlpha).toMatch(/rgba\(.+, 0\.1\)/);
  await overall.press("End");
  await expect(overall).toHaveValue("100");
  await app.screenshot("transparency-global");

  await browser.reload();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await expect.poll(sidebarAlpha).toMatch(/^rgb\(/);
  await browser.keyboard.press("Control+Comma");
  await dialog.getByRole("button", "Transparency").tap();
  await expect(global).toBeChecked();
  await parts.tap();
  await expect(sidebar).toHaveValue("40");
  await expect.poll(sidebarAlpha).toMatch(/rgba\(.+, 0\.4\)/);
  await expect
    .poll(() =>
      browser.evaluate(() => JSON.parse(localStorage.getItem("cairngorm-transparency")!).priority),
    )
    .toBe("parts");

  await dialog.getByRole("switch", "Transparent window").tap();
  await expect(global).toBeDisabled();
  await expect(parts).toBeDisabled();
  await expect(sidebar).toBeDisabled();
  await expect(overall).toBeDisabled();
  await dialog.getByRole("switch", "Transparent window").tap();
  await expect(sidebar).toBeEnabled();
  await expect.poll(sidebarAlpha).toMatch(/rgba\(.+, 0\.4\)/);
});
