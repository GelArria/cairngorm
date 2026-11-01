import { test, expect } from "./fixtures";

test.describe("Sidebar resize", () => {
  test("Resizable container uses flex layout (not absolute overlay)", async ({ app }) => {
    const sidebar = app.locator('[data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();

    // Navigate up: sidebar -> flex-1 wrapper -> Resizable container
    const resizableContainer = sidebar.locator("../..");
    const containerClass = (await resizableContainer.getAttribute("class")) ?? "";
    expect(containerClass).toContain("flex");
    // "relative" should NOT come from Resizable (only from child class props)
    // The Resizable component itself no longer sets "relative" — it sets "flex"
  });

  test("dragging resize handle changes sidebar width", async ({ app }) => {
    // A real pointer drag must not land on the startup splash.
    await app.evaluate(() => localStorage.setItem("show-splash", "false"));
    await app.reload();
    await app.waitForSelector('[data-testid="sidebar"]');
    const sidebar = app.locator('[data-testid="sidebar"]');
    const resizableContainer = sidebar.locator("../..");
    const initialWidth = await resizableContainer.evaluate(
      (el) => el.getBoundingClientRect().width,
    );

    // Resize handle = the narrow 3px div, last child of the flex container
    const handle = resizableContainer.locator("> div").last();
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();
    expect(handleBox!.width).toBeLessThanOrEqual(5);

    if (handleBox) {
      // Click and drag from the center of the handle
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      // A real drag: the button stays pressed while moving (a moved pointer with no
      // button pressed cancels the drag).
      await app.mouse.move(startX, startY);
      await app.mouse.down();
      await app.mouse.move(startX + 100, startY, { steps: 10 });
      await app.mouse.up();

      await app.waitForTimeout(300);

      const newWidth = await resizableContainer.evaluate((el) => el.getBoundingClientRect().width);
      expect(newWidth).toBeGreaterThan(initialWidth);
    }
  });

  test("handle sits flush at right edge of sidebar container", async ({ app }) => {
    const sidebar = app.locator('[data-testid="sidebar"]');
    const resizableContainer = sidebar.locator("../..");
    const containerBox = await resizableContainer.boundingBox();

    const handle = resizableContainer.locator("> div").last();
    const handleBox = await handle.boundingBox();

    expect(containerBox).toBeTruthy();
    expect(handleBox).toBeTruthy();

    if (containerBox && handleBox) {
      const handleRight = handleBox.x + handleBox.width;
      const containerRight = containerBox.x + containerBox.width;
      expect(Math.abs(handleRight - containerRight)).toBeLessThan(2);
    }
  });
});
