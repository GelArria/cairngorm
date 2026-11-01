import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/** Projects live in the sidebar's picker (dock style); it closes when the project changes. */
async function openProjects(app: Page) {
  const grid = app.locator('[data-testid="projects-grid"]');
  if (!(await grid.isVisible())) {
    await app.getByTestId("sidebar-project-picker").click();
  }
  await expect(grid).toBeVisible();
}

test("New project fills odd gaps and becomes a flat full-width bar for even counts", async ({
  app,
}) => {
  const grid = app.getByTestId("projects-grid");
  const add = app.getByTestId("legend-add-projects");
  const cards = grid.locator('[data-testid^="project-box-"]');

  for (let count = 1; count <= 4; count++) {
    await openProjects(app);
    await expect(cards).toHaveCount(count);
    const first = (await cards.first().boundingBox())!;
    const last = (await cards.last().boundingBox())!;
    const button = (await add.boundingBox())!;
    if (count % 2 === 0) {
      expect(button.height).toBe(32);
      expect(button.x).toBe(first.x);
      expect(button.width).toBeCloseTo(last.x + last.width - first.x, 0);
      expect(button.y).toBeGreaterThan(last.y + last.height);
    } else {
      expect(button.height).toBe(first.height);
      expect(button.width).toBeCloseTo(first.width, 0);
      expect(button.y).toBe(last.y);
      expect(button.x).toBeGreaterThan(last.x + last.width);
    }
    await grid.screenshot({ path: `logs/e2e/new-project-${count}.png` });
    if (count < 4) {
      await app.evaluate((n) => {
        (window as any).__E2E_PICK__ = `C:/code/project-${n}`;
      }, count);
      await add.click();
      await expect(app.getByTestId("active-project-name")).toHaveText(`project-${count}`);
    }
  }
});
