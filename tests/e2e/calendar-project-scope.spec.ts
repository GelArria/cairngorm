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

test("sidebar calendar follows the selected project without leaking its events", async ({
  app,
}) => {
  await app.evaluate(async () => {
    const url = "/src/projects/api.ts";
    const projects = await import(/* @vite-ignore */ url);
    const homeId = projects.getActiveProject().id;
    const api = (window as any).__TAURI_INTERNALS__;
    const original = api.invoke;
    api.invoke = (cmd: string, args: any) => {
      if (cmd === "plugin:sql|select" && /FROM\s+calendar_events/i.test(args.query)) {
        const today = new Date();
        const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        return Promise.resolve(
          args.values?.[0] === homeId
            ? [
                {
                  id: "home-event",
                  title: "Home meeting",
                  date,
                  end_date: null,
                  start_time: "09:00",
                  end_time: "10:00",
                  color: "blue",
                  description: "",
                },
              ]
            : [],
        );
      }
      return original(cmd, args);
    };
  });
  await app.locator('[data-testid="mode-calendar"]').click();
  const calendar = app.locator('[data-testid="calendar-view"]');
  await calendar.getByRole("radio", { name: "Calendar events" }).click();
  await expect(calendar.getByText("Home meeting").first()).toBeVisible();
  await expect(app.locator('[data-testid="sidebar"]').getByTestId("calendar-view")).toBeVisible();
  await app.evaluate(() => {
    (window as any).__E2E_PICK__ = "C:/code/calendar-project";
  });
  await openProjects(app);
  await app.locator('[data-testid="legend-add-projects"]').click();
  await expect(app.locator('[data-testid="active-project-name"]')).toHaveText("calendar-project");
  await app.locator('[data-testid="mode-calendar"]').click();
  await expect(calendar).toBeVisible();
  await expect(calendar.getByText("Home meeting")).toHaveCount(0);
  await expect(calendar.getByText("No events this month")).toBeVisible();
  await app.takeScreenshot("calendar-project-empty");
  await openProjects(app);
  await app.locator('[data-testid^="project-box-"]').filter({ hasText: "Home" }).click();
  await expect(calendar.getByText("Home meeting").first()).toBeVisible();
  await expect(app.locator('[data-testid="sidebar"]').getByTestId("calendar-view")).toBeVisible();
  await app.takeScreenshot("calendar-project-home");
});
