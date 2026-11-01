import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

test("keyboard resizing accounts for every row gap and announces the separator value", async ({
  app,
  browser,
  screen,
}) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await browser.evaluate(async () => {
    const url = "/src/terminal/hooks/use-terminal-tabs.ts";
    const store = await import(/* @vite-ignore */ url);
    store.attachGroup(
      Array.from({ length: 10 }, (_, n) => ({
        id: `keyboard-${n}`,
        sessionId: `keyboard-session-${n}`,
        title: `Terminal ${n}`,
        shellPath: "powershell.exe",
        cwd: "C:/workspace",
      })),
      {
        columnCount: 1,
        columnRatios: [1],
        cells: Array.from({ length: 10 }, (_, row) => ({
          id: `k${row}`,
          tabId: `keyboard-${row}`,
          col: 0,
          row,
          colSpan: 1,
          rowSpan: 1,
        })),
      },
    );
  });
  const pane = browser.locator('[data-pane-id="keyboard-0"]');
  const handle = pane.getByRole("separator", "Resize pane height");
  await expect(handle).toHaveAttribute("aria-valuenow", "10");
  await handle.focus();
  for (let i = 0; i < 10; i++) {
    await handle.press("ArrowUp");
  }
  await expect.poll(async () => (await pane.boundingBox())!.height).toBeCloseTo(40, 1);
  expect(Number(await handle.getAttribute("aria-valuenow"))).toBeLessThan(10);
  await handle.press("ArrowDown");
  await expect.poll(async () => (await pane.boundingBox())!.height).toBeCloseTo(50, 1);
});
