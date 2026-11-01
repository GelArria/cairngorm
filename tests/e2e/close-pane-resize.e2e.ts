// Closing a pane that is not a terminal (application, plugin view) and then resizing the
// remaining split must keep the workspace working.
import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    localStorage.setItem("sidebar-side", "left");
    localStorage.setItem("show-splash", "false");
    const w = window as any;
    w.__errors = [];
    window.addEventListener("error", (event) => w.__errors.push(String(event.message)));
    window.addEventListener("unhandledrejection", (event) =>
      w.__errors.push(String(event.reason?.message ?? event.reason)),
    );
    w.__TAURI_INTERNALS__.metadata = {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown, options?: unknown) =>
      cmd === "app_window_dock"
        ? Promise.resolve(true)
        : cmd === "app_window_release"
          ? Promise.resolve(null)
          : original(cmd, args, options);
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await browser.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/terminal/hooks/use-terminal-tabs.ts");
    store.attachGroup(
      [1, 2].map((n) => ({
        id: `close-${n}`,
        sessionId: `close-session-${n}`,
        title: `Terminal ${n}`,
        shellPath: "powershell.exe",
        cwd: "C:/workspace",
      })),
      {
        columnCount: 2,
        columnRatios: [1, 1],
        cells: [
          { id: "a", tabId: "close-1", col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          { id: "b", tabId: "close-2", col: 1, row: 0, colSpan: 1, rowSpan: 1 },
        ],
      },
    );
  });
});

test("closing an application pane and resizing the split keeps the workspace alive", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(async () => {
    const store = await import(/* @vite-ignore */ "/src/terminal/hooks/use-terminal-tabs.ts");
    store.openAppTab({
      sessionId: "close-session-1",
      appId: "excel",
      appName: "Microsoft Excel",
      hwnd: "4242",
      title: "Book1 - Excel",
    });
  });
  await expect(screen.getByTestId("app-window-pane")).toBeVisible();
  await browser.evaluate(() => {
    const tab = document.querySelector<HTMLElement>('[role="tab"][aria-label="Book1 - Excel"]')!;
    tab.parentElement!.querySelector<HTMLElement>("[data-tab-close]")!.click();
  });
  await expect(screen.getByTestId("app-window-pane")).toHaveCount(0);

  for (const separator of await browser.locator('[role="separator"]').all()) {
    const box = await separator.boundingBox();
    if (!box) continue;
    await browser.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 6 });
    await browser.mouse.up();
  }
  await browser.setViewport({ width: 900, height: 700 });
  await browser.setViewport({ width: 1440, height: 900 });
  await app.screenshot("close-pane-resize");
  await expect(browser.locator('[data-pane-id="close-1"]')).toBeVisible();
  await expect(browser.locator('[data-pane-id="close-2"]')).toBeVisible();
  expect(await errors(browser)).toEqual([]);
});

test("closing a file pane and resizing keeps the workspace alive", async ({
  app,
  browser,
  screen,
}) => {
  await browser.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("editor-open-file", {
        detail: {
          title: "notes.txt",
          path: ["notes.txt"],
          fullPath: "C:/workspace/notes.txt",
          content: "hello",
          extension: "txt",
        },
      }),
    );
  });
  await expect
    .poll(() =>
      browser.evaluate(() => !!document.querySelector('[role="tab"][aria-label="notes.txt"]')),
    )
    .toBe(true);
  await browser.evaluate(() => {
    const tab = document.querySelector<HTMLElement>('[role="tab"][aria-label="notes.txt"]')!;
    tab.click();
  });
  await browser.evaluate(() => {
    const tab = document.querySelector<HTMLElement>('[role="tab"][aria-label="notes.txt"]')!;
    tab.parentElement!.querySelector<HTMLElement>("[data-tab-close]")!.click();
  });
  await expect
    .poll(() =>
      browser.evaluate(() => !!document.querySelector('[role="tab"][aria-label="notes.txt"]')),
    )
    .toBe(false);
  for (const separator of await browser.locator('[role="separator"]').all()) {
    const box = await separator.boundingBox();
    if (!box) continue;
    await browser.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await browser.mouse.down();
    await browser.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60, { steps: 6 });
    await browser.mouse.up();
  }
  await browser.setViewport({ width: 900, height: 700 });
  await browser.setViewport({ width: 1440, height: 900 });
  await app.screenshot("close-file-pane-resize");
  await expect(screen.getByRole("tab", "Terminal 1")).toBeVisible();
  expect(await errors(browser)).toEqual([]);
});

/** Page errors, without the mock runtime's missing window-event commands. */
async function errors(browser: any): Promise<string[]> {
  const all: string[] = await browser.evaluate(() => (window as any).__errors);
  return all.filter((message) => !message.includes("plugin:event|listen"));
}
