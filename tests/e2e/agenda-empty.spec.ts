import { test, expect } from "./fixtures";

// An empty month remains navigable and can still create an event.
test("empty sidebar calendar shows its month grid and launches the event form", async ({ app }) => {
  await app.evaluate(() => localStorage.setItem("show-splash", "false"));
  await app.reload();
  // Fixture always seeds one event; swap the SQL mock for an empty answer BEFORE the
  // agenda module mounts, so it renders its empty state.
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
  await sidebar.getByRole("button", { name: "Calendar", exact: true }).click();
  const calendar = sidebar.getByTestId("calendar-view");
  await calendar.getByRole("radio", { name: "Calendar events" }).click();
  await expect(calendar.getByText("No events this month")).toBeVisible();
  await expect(calendar.getByRole("region", { name: "Monthly calendar" })).toBeVisible();
  await app.takeScreenshot("calendar-empty-context");
  await calendar.screenshot({ path: "logs/e2e/calendar-empty.png" });
  expect(await calendar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await calendar.getByRole("button", { name: "New event", exact: true }).click();
  await expect(app.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
});
