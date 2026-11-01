import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(SEED_INIT);
  await browser.addInitScript(() => {
    localStorage.setItem("sidebar-side", "left");
    localStorage.setItem("show-splash", "false");
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await browser.evaluate(async () => {
    const url = "/src/terminal/hooks/use-terminal-tabs.ts";
    const store = await import(/* @vite-ignore */ url);
    store.attachGroup(
      [1, 2, 3].map((n) => ({
        id: `resize-${n}`,
        sessionId: `resize-session-${n}`,
        title: `Terminal ${n}`,
        shellPath: "powershell.exe",
        cwd: "C:/workspace",
      })),
      {
        columnCount: 2,
        columnRatios: [1, 1],
        cells: [
          { id: "a", tabId: "resize-1", col: 0, row: 0, colSpan: 1, rowSpan: 1 },
          { id: "b", tabId: "resize-2", col: 0, row: 1, colSpan: 1, rowSpan: 1 },
          { id: "c", tabId: "resize-3", col: 1, row: 0, colSpan: 1, rowSpan: 2 },
        ],
      },
    );
  });
  await expect(screen.getByRole("separator", "Resize pane height")).toBeVisible();
});

test("dragging horizontal and vertical edges resizes panes and survives reload", async ({
  app,
  browser,
  screen,
}) => {
  const top = browser.locator('[data-pane-id="resize-1"]');
  const bottom = browser.locator('[data-pane-id="resize-2"]');
  const right = browser.locator('[data-pane-id="resize-3"]');
  const handle = screen.getByRole("separator", "Resize pane height");
  const initial = (await top.boundingBox())!;
  const bottomInitial = (await bottom.boundingBox())!;
  const rightInitial = (await right.boundingBox())!;
  await app.screenshot("pane-resize-before");
  const edge = (await handle.boundingBox())!;
  await browser.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await browser.mouse.down();
  await browser.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2 + 120, { steps: 8 });
  await browser.mouse.up();
  await expect
    .poll(async () => (await top.boundingBox())!.height)
    .toBeCloseTo(initial.height + 120, 0);
  expect((await bottom.boundingBox())!.height).toBeCloseTo(bottomInitial.height - 120, 0);
  expect((await right.boundingBox())!.height).toBeCloseTo(rightInitial.height, 0);
  const colEdge = (await browser
    .locator('[data-pane-id="resize-1"] [data-col-resizer]')
    .boundingBox())!;
  await browser.mouse.move(colEdge.x + 1, colEdge.y + 30);
  await browser.mouse.down();
  await browser.mouse.move(colEdge.x + 81, colEdge.y + 30, { steps: 6 });
  await browser.mouse.up();
  await expect
    .poll(async () => (await top.boundingBox())!.width)
    .toBeCloseTo(initial.width + 80, 0);
  const resizedHeight = (await top.boundingBox())!.height;
  await browser.reload();
  await expect(handle).toBeVisible();
  await expect.poll(async () => (await top.boundingBox())!.height).toBeCloseTo(resizedHeight, 0);
  await handle.hover();
  await app.screenshot("pane-resize-after");
});

test("keyboard resizing, minimum height, zoom and interrupted drags remain safe", async ({
  browser,
  screen,
}) => {
  const top = browser.locator('[data-pane-id="resize-1"]');
  const bottom = browser.locator('[data-pane-id="resize-2"]');
  const handle = screen.getByRole("separator", "Resize pane height");
  const initial = (await top.boundingBox())!.height;
  await handle.focus();
  await handle.press("ArrowDown");
  await expect.poll(async () => (await top.boundingBox())!.height).toBeGreaterThan(initial + 9);
  const edge = (await handle.boundingBox())!;
  await browser.mouse.move(edge.x + 60, edge.y + 1);
  await browser.mouse.down();
  await browser.mouse.move(edge.x + 60, 0, { steps: 5 });
  await browser.mouse.up();
  await expect.poll(async () => (await top.boundingBox())!.height).toBeCloseTo(40, 0);
  const clampedHeight = (await top.boundingBox())!.height;
  const minimumEdge = (await handle.boundingBox())!;
  await browser.mouse.move(minimumEdge.x + 60, minimumEdge.y + 1);
  await browser.mouse.down();
  await browser.evaluate(() => window.dispatchEvent(new Event("blur")));
  await browser.mouse.move(minimumEdge.x + 60, minimumEdge.y + 150);
  await browser.mouse.up();
  expect((await top.boundingBox())!.height).toBeCloseTo(clampedHeight, 0);
  expect(
    await browser.evaluate(() => [document.body.style.cursor, document.body.style.userSelect]),
  ).toEqual(["", ""]);
  await bottom.secondaryTap();
  await screen.getByRole("menuitem", "Zoom pane").tap();
  await expect(handle).toBeHidden();
  await bottom.secondaryTap();
  await screen.getByRole("menuitem", "Restore pane").tap();
  await expect(handle).toBeVisible();
});
