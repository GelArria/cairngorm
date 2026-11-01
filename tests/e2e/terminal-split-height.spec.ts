import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { arrange, splitNew } from "./split-helpers";

async function geometry(app: Page) {
  return app.evaluate(() => {
    const grid = document.querySelector("[data-pane-id]")!.parentElement!;
    const area = grid.parentElement!.getBoundingClientRect();
    return {
      viewport: { height: innerHeight, width: innerWidth },
      area: {
        top: area.top,
        bottom: area.bottom,
        left: area.left,
        right: area.right,
        height: area.height,
        width: area.width,
      },
      panes: Array.from(grid.querySelectorAll<HTMLElement>("[data-pane-id]")).map((pane) => {
        const r = pane.getBoundingClientRect();
        const screen = pane.querySelector(".xterm-screen")!.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          height: r.height,
          width: r.width,
          screenHeight: screen.height,
          screenWidth: screen.width,
        };
      }),
    };
  });
}

async function resize(app: Page, viewport: { width: number; height: number }) {
  await app.setViewportSize(viewport);
  // Reapply metrics: Chromium on Windows can retain the pre-screenshot viewport.
  const cdp = await app.context().newCDPSession(app);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.detach();
  await expect
    .poll(() => app.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    .toEqual(viewport);
}

async function expectFilled(app: Page, axis: "height" | "width", count: number) {
  await expect(app.locator("[data-pane-id]:visible")).toHaveCount(count);
  await expect(app.locator("[data-pane-id]:visible .xterm-screen:visible")).toHaveCount(count);
  // FitAddon/ResizeObserver settle asynchronously after each layout change.
  await expect
    .poll(async () => {
      const { area, panes, viewport } = await geometry(app);
      const horizontal = axis === "height";
      const target = (area[axis] - 4 - (count - 1) * 2) / count;
      return Math.max(
        Math.abs(area.bottom - viewport.height),
        Math.abs(area.right - viewport.width),
        Math.abs(Math.min(...panes.map((p) => p.top)) - area.top - 2),
        Math.abs(Math.max(...panes.map((p) => p.bottom)) - area.bottom + 2),
        Math.abs(Math.min(...panes.map((p) => p.left)) - area.left - 2),
        Math.abs(Math.max(...panes.map((p) => p.right)) - area.right + 2),
        ...panes.map((p) => Math.abs(p[axis] - target)),
        ...panes.map((p) =>
          Math.abs(p[horizontal ? "width" : "height"] - area[horizontal ? "width" : "height"] + 4),
        ),
        // The screen excludes xterm padding, scrollbar and a partial character cell.
        ...panes.map((p) =>
          Math.max(
            0,
            p.height - p.screenHeight - 32,
            p.width - p.screenWidth - 48,
            p.screenHeight - p.height,
            p.screenWidth - p.width,
          ),
        ),
      );
    })
    .toBeLessThanOrEqual(1);
}

for (const scenario of [
  { name: "stacked", arrange: "Stacked" as const, axis: "height" as const },
  { name: "side-by-side", arrange: "Side by side" as const, axis: "width" as const },
]) {
  test(`${scenario.name} splits fill the area after resize and tab switches`, async ({ app }) => {
    const tablist = app.getByRole("tablist", { name: "Workspace tabs" });
    await tablist.getByRole("button", { name: "New terminal", exact: true }).click();
    await app.getByRole("menuitem", { name: "Default shell", exact: true }).click();
    await expect(app.locator(".xterm-screen")).toBeVisible();
    for (let count = 2; count <= 4; count++) {
      await splitNew(app);
      await arrange(app, scenario.arrange);
      await expectFilled(app, scenario.axis, count);
      if (count === 2) {
        await resize(app, { width: 1278, height: 1390 });
        await expectFilled(app, scenario.axis, count);
        await app.takeScreenshot(`split-${scenario.name}-two-panes`);
        await resize(app, { width: 1440, height: 900 });
        await expectFilled(app, scenario.axis, count);
      }
    }
    for (const viewport of [
      { width: 1278, height: 1390 },
      { width: 1024, height: 720 },
      { width: 1440, height: 900 },
    ]) {
      await resize(app, viewport);
      await expectFilled(app, scenario.axis, 4);
      if (viewport.height === 1390) await app.takeScreenshot(`split-${scenario.name}-tall`);
    }
    for (const tab of await tablist.getByRole("tab").all()) {
      await tab.click();
      await expectFilled(app, scenario.axis, 4);
    }
    // Typing still reaches the mocked PTY bridge after the splits.
    const beforeTyping = await app.evaluate(() => (window as any).__CMD_LOG__.length);
    await app.locator('[data-pane-id][data-active="true"] .xterm-helper-textarea').focus();
    await app.keyboard.type("split-check");
    await expect
      .poll(() =>
        app.evaluate(
          (offset) =>
            (window as any).__CMD_LOG__
              .slice(offset)
              .filter((s: string) => s.startsWith("pty_write:"))
              .map((s: string) => JSON.parse(s.slice("pty_write:".length)).data)
              .join(""),
          beforeTyping,
        ),
      )
      .toBe("split-check");
    console.log(`${scenario.name}:`, JSON.stringify(await geometry(app)));
  });
}
