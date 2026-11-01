import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const SHOTS = "logs/e2e/sidebar-fold";

async function ready(app: Page, side: "left" | "right") {
  await app.emulateMedia({ reducedMotion: "no-preference" });
  await app.evaluate((s) => {
    localStorage.setItem("sidebar-side", s);
    localStorage.setItem("show-splash", "false");
  }, side);
  await app.reload();
  await app.waitForSelector('[data-testid="sidebar"]');
}

async function edge(app: Page) {
  const container = app.locator(".sidebar-fold");
  const handle = container.locator(".fold-handle");
  const box = (await handle.boundingBox())!;
  return { container, handle, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

for (const side of ["left", "right"] as const) {
  test(`${side} sidebar folds into its rail by dragging the edge, and unfolds again`, async ({
    app,
  }) => {
    await ready(app, side);
    const inward = side === "left" ? -1 : 1;
    const { container, x, y } = await edge(app);

    await app.mouse.move(x, y);
    await app.mouse.down();
    // Past the minimum but before the point of no return: folding, not armed.
    await app.mouse.move(x + inward * 70, y, { steps: 8 });
    await expect(container).toHaveAttribute("data-fold", "collapse");
    await expect(container).not.toHaveAttribute("data-armed", "");
    await app.screenshot({ path: `${SHOTS}-${side}-1-folding.png` });

    // Deep in the fold: armed, the project's gem sits on the edge.
    await app.mouse.move(x + inward * 175, y, { steps: 8 });
    await expect(container).toHaveAttribute("data-armed", "");
    // Armed shows as a solid edge only: no mark appears on it.
    await expect(container.locator(".fold-mark")).toHaveCount(0);
    await app.screenshot({ path: `${SHOTS}-${side}-2-armed.png` });

    await app.mouse.up();
    await expect(app.getByTestId("sidebar-collapsed")).toBeVisible();
    await app.waitForTimeout(260);
    await app.screenshot({ path: `${SHOTS}-${side}-3-landing.png` });
    // Lands quietly: no glint sweeps the rail.
    expect(await container.evaluate((el) => getComputedStyle(el, "::after").content)).toBe("none");
    expect((await container.boundingBox())!.width).toBeLessThan(50);

    // Pull the rail's edge outward to unfold.
    const rail = await edge(app);
    await app.mouse.move(rail.x, rail.y);
    await app.mouse.down();
    await app.mouse.move(rail.x - inward * 110, rail.y, { steps: 8 });
    await expect(container).toHaveAttribute("data-fold", "expand");
    await app.screenshot({ path: `${SHOTS}-${side}-4-unfolding.png` });
    await app.mouse.up();
    await expect(app.getByTestId("sidebar")).toBeVisible();
    await app.waitForTimeout(400);
    expect((await container.boundingBox())!.width).toBeGreaterThan(250);
  });
}

test("releasing before the point of no return springs back", async ({ app }) => {
  await ready(app, "left");
  const { container, x, y } = await edge(app);
  const before = (await container.boundingBox())!.width;
  await app.mouse.move(x, y);
  await app.mouse.down();
  await app.mouse.move(x - 60, y, { steps: 6 });
  await app.mouse.up();
  await app.waitForTimeout(400);
  await expect(app.getByTestId("sidebar")).toBeVisible();
  expect(Math.abs((await container.boundingBox())!.width - Math.max(260, before))).toBeLessThan(30);
});

test("reduced motion keeps the fold still: no slide or blur", async ({ app }) => {
  await ready(app, "left");
  await app.emulateMedia({ reducedMotion: "reduce" });
  const { container, x, y } = await edge(app);
  await app.mouse.move(x, y);
  await app.mouse.down();
  await app.mouse.move(x - 175, y, { steps: 8 });
  await expect(container).toHaveAttribute("data-armed", "");
  const panel = app.getByTestId("sidebar");
  expect(await panel.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  expect(await panel.evaluate((el) => getComputedStyle(el).filter)).toBe("none");
  await app.mouse.up();
  await expect(app.getByTestId("sidebar-collapsed")).toBeVisible();
});
