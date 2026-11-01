import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

test("database fallback is visible without moving the workspace and explains the risk", async ({
  app,
  browser,
  screen,
}) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    if (!location.protocol.startsWith("http")) return;
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
    const internal = (window as any).__TAURI_INTERNALS__;
    const original = internal.invoke;
    internal.invoke = (cmd: string, args: any) => {
      if (cmd === "plugin:sql|select") {
        if ((window as any).__FAIL_STORAGE__ && args.query.includes("terminal_state")) {
          return Promise.reject("database is locked");
        }
        return Promise.resolve([]);
      }
      if (cmd === "plugin:sql|execute") return Promise.resolve([0, 0]);
      return original(cmd, args);
    };
  });
  await app.open();
  await expect(screen.getByTestId("header-settings")).toBeVisible();
  await expect(screen.getByTestId("storage-warning")).toHaveCount(0);
  const before = await screen.getByTestId("sidebar").boundingBox();
  await browser.evaluate(async () => {
    (window as any).__FAIL_STORAGE__ = true;
    const storage = await import(/* @vite-ignore */ "/src/terminal/data/native-storage.ts");
    await storage.initializeStorage("storage-warning-check");
  });
  const warning = screen.getByRole("button", "Changes may not be saved");
  await expect(warning).toBeVisible();
  expect(await screen.getByTestId("sidebar").boundingBox()).toEqual(before);
  await warning.tap();
  await expect(screen.getByRole("alert")).toContainText(
    "Terminals could not be saved to Cairngorm's database",
  );
  await expect(screen.getByRole("alert")).toContainText("changes may be lost");
  await app.screenshot("storage-fallback-warning");
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("alert")).toHaveCount(0);
  await expect(warning).toBeVisible();
  await browser.setViewport({ width: 390, height: 720 });
  await warning.tap();
  await expect(screen.getByRole("alert")).toBeVisible();
  expect(await browser.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
    false,
  );
  for (const control of [
    warning,
    screen.getByTestId("header-settings"),
    screen.getByRole("button", "Close", { exact: true }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await app.screenshot("storage-fallback-warning-narrow");
});
