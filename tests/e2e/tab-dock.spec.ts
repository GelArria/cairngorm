import { test, expect } from "./fixtures";

// Dragging a tab from the bar onto a pane docks it into the grid (split view).
test.describe("Tab → grid docking", () => {
  test("drag the 2nd tab onto the right half of the visible pane: side-by-side split", async ({
    app,
  }) => {
    for (let i = 0; i < 2; i++) {
      await app.locator('button[aria-label="New terminal"]').first().click();
      await app.getByText("Default shell").click();
    }
    const panes = app.locator("[data-pane-id]:visible");
    await expect(panes).toHaveCount(1); // single view: only the active tab shows

    // Show tab 1 again, then drag tab 2 onto tab 1's pane
    const tabs = app.locator('[data-testid="tab-title"]');
    await expect(tabs).toHaveCount(2);
    await tabs.nth(0).click();
    const pane = (await panes.first().boundingBox())!;
    const tab2 = (await tabs.nth(1).boundingBox())!;
    await app.mouse.move(tab2.x + 10, tab2.y + 5);
    await app.mouse.down();
    await app.mouse.move(tab2.x + 60, tab2.y + 60, { steps: 5 });
    await app.mouse.move(pane.x + pane.width * 0.9, pane.y + pane.height * 0.5, { steps: 8 });
    const zone = app.locator('[data-testid="dock-zone"]');
    await expect(zone).toBeVisible();
    await expect(zone).toHaveAttribute("data-edge", "right");
    await app.takeScreenshot("tab-dock-preview");
    await app.mouse.up();

    await expect(zone).toBeHidden();
    await expect(panes).toHaveCount(2);
    const [a, b] = [(await panes.nth(0).boundingBox())!, (await panes.nth(1).boundingBox())!];
    expect(Math.abs(a.y - b.y)).toBeLessThan(4); // side by side
    expect(b.x).toBeGreaterThan(a.x + a.width / 2);
    await app.takeScreenshot("tab-dock-done");
  });
});
