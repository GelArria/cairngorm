import { test, expect } from "./fixtures";
import type { Locator } from "@playwright/test";

/** The empty state sits in the vertical middle of its panel (within a few pixels). */
async function expectCentered(panel: Locator, empty: Locator) {
  const outer = (await panel.boundingBox())!;
  const inner = (await empty.boundingBox())!;
  const above = inner.y - outer.y;
  const below = outer.y + outer.height - (inner.y + inner.height);
  expect(Math.abs(above - below)).toBeLessThan(60);
}

test("sidebar empty states share one centered style", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  await app.evaluate(() => {
    const i = window.__TAURI_INTERNALS__;
    const invoke = i.invoke;
    i.invoke = (cmd, a) =>
      cmd === "plugin:sql|select" && /FROM\s+calendar_events/i.test(String(a?.query ?? ""))
        ? Promise.resolve([])
        : invoke(cmd, a);
  });
  await app.evaluate(() => window.dispatchEvent(new CustomEvent("calendar-events-changed")));
  const sidebar = app.locator('[data-testid="sidebar"]');

  const terminals = sidebar.getByTestId("project-terminals");
  const noTerminals = terminals.getByTestId("project-terminals-empty");
  await expect(noTerminals.getByRole("heading", { name: "Nothing open yet" })).toBeVisible();
  await expectCentered(terminals, noTerminals);
  await sidebar.screenshot({ path: "logs/e2e/empty-terminals.png" });

  await sidebar.getByRole("button", { name: "Calendar", exact: true }).click();
  const calendar = sidebar.getByTestId("calendar-view");
  await calendar.getByRole("radio", { name: "Scheduled tasks" }).click();
  const tasks = calendar.getByRole("region", { name: "Scheduled tasks" });
  await expect(tasks.getByText("No scheduled tasks")).toBeVisible();
  await expectCentered(
    tasks,
    tasks.locator("div").filter({ hasText: "No scheduled tasks" }).last(),
  );
  await sidebar.screenshot({ path: "logs/e2e/empty-scheduled.png" });

  await calendar.getByRole("radio", { name: "Calendar events" }).click();
  const events = calendar.getByRole("region", { name: "Month events" });
  await expect(events.getByText("No events this month")).toBeVisible();
  await sidebar.screenshot({ path: "logs/e2e/empty-calendar.png" });
});
