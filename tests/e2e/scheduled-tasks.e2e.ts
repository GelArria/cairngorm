import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { SEED_INIT } from "../mocks/tauri-seed";
import { SCHEDULE_INIT } from "../mocks/scheduled-tasks";

beforeEach(async ({ app, browser, screen }) => {
  await browser.addInitScript(`${SEED_INIT}\n${SCHEDULE_INIT}`);
  await browser.addInitScript(() => {
    if (location.protocol.startsWith("http")) {
      localStorage.setItem("sidebar-side", "left");
      localStorage.setItem("show-splash", "false");
      localStorage.setItem("active-project-id", "one");
    }
  });
  await app.open();
  await expect(screen.getByTestId("sidebar")).toBeVisible();
  await screen.getByTestId("mode-calendar").tap();
  await expect(screen.getByRole("button", "Schedule event")).toBeEnabled({ timeout: 30000 });
});

test("a past local time shows the AM/PM guidance without saving a schedule", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByRole("button", "Schedule event").tap();
  const form = screen.getByRole("dialog", "Schedule event");
  await form.getByLabel("Task name").fill("Past time check");
  await form.getByLabel("Instructions").fill("Do not run this invalid schedule.");
  const past = await browser.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    date.setHours(9, 11, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:11`;
  });
  await form.getByLabel("Run at (local time)").fill(past);
  await form.getByRole("button", "Review schedule").tap();
  await expect(form.getByRole("alert")).toHaveText(
    "The run time is in the past. Choose a future date and time (check AM/PM).",
  );
  expect(
    await browser.evaluate(
      () => JSON.parse(localStorage.getItem("qa-scheduled-tasks") || "[]").length,
    ),
  ).toBe(0);
  await app.screenshot("schedule-past-time-error");
});

test("schedule, review, activate, edit, pause, run, inspect and delete a task", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByRole("button", "Schedule event").tap();
  const form = screen.getByRole("dialog", "Schedule event");
  await form.getByLabel("Task name").fill("Review recent changes");
  await form
    .getByLabel("Instructions")
    .fill("Review this project and summarize risks. Do not commit or push.");
  await form.getByRole("radio", "Every interval").tap();
  await form.getByLabel("Repeat every (minutes)").fill("30");
  await app.screenshot("schedule-task-form");
  await form.getByRole("button", "Review schedule").tap();
  const review = screen.getByRole("dialog", "Review schedule");
  await expect(review.getByText("Every 30 minutes")).toBeVisible();
  await expect(review.getByRole("button", "Activate schedule")).toBeDisabled();
  expect(
    await browser.evaluate(
      () => JSON.parse(localStorage.getItem("qa-scheduled-tasks") || "[]").length,
    ),
  ).toBe(0);
  await app.screenshot("schedule-task-review");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", "Activate schedule").tap();
  await expect(review).toBeHidden();
  let row = screen.getByRole("article", "Review recent changes");
  await expect(row).toBeVisible();
  await row.getByRole("button", "Pause").tap();
  await expect(row.getByText("Schedule paused")).toBeVisible();
  await row.getByRole("button", "Resume").tap();
  await expect(row.getByRole("button", "Pause")).toBeVisible();
  await row.getByRole("button", "Edit").tap();
  const edit = screen.getByRole("dialog", "Edit scheduled task");
  await edit.getByLabel("Task name").fill("Review changed files");
  await edit.getByRole("button", "Review schedule").tap();
  await review.getByRole("checkbox").check();
  await review.getByRole("button", "Activate schedule").tap();
  row = screen.getByRole("article", "Review changed files");
  await row.getByRole("button", "Run now").tap();
  await expect(row.getByText("Succeeded")).toBeVisible();
  await row.getByRole("button", "Last result").tap();
  const result = screen.getByRole("dialog", "Last run result");
  await expect(result.getByText("Review finished. No changes were committed.")).toBeVisible();
  await result.getByRole("button", "Close", { exact: true }).tap();
  await app.screenshot("schedule-task-list");
  await app.open();
  await screen.getByTestId("mode-calendar").tap();
  await expect(row).toBeVisible();
  await row.getByRole("button", "Delete").tap();
  const confirm = screen.getByRole("dialog", "Delete scheduled task?");
  await confirm.getByRole("button", "Delete task").tap();
  await expect(row).toBeHidden();
  await expect(screen.getByText("No scheduled tasks")).toBeVisible();
});

test("a running schedule refuses project removal without losing the project or its terminal", async ({
  browser,
  screen,
}) => {
  await screen.getByTestId("mode-calendar").tap();
  await screen.getByTestId("project-terminals-empty").getByRole("button", "New terminal").tap();
  const pane = browser.locator("[data-pane-id]").first();
  await expect(pane).toBeVisible();
  const paneId = await pane.getAttribute("data-pane-id");
  await browser.evaluate(() => {
    (window as typeof window & { __FAIL_PROJECT_DELETE__?: boolean }).__FAIL_PROJECT_DELETE__ =
      true;
  });
  await screen.getByTestId("sidebar-project-picker").tap();
  await screen.getByTestId("project-box-one").secondaryTap();
  await screen.getByRole("menuitem", "Remove Project…").tap();
  const confirm = screen.getByRole("dialog", "Remove project");
  await confirm.getByRole("button", "Remove", { exact: true }).tap();
  await expect(confirm.getByRole("alert")).toContainText("scheduled run");
  await expect(screen.getByTestId("project-box-one")).toBeVisible();
  expect(await pane.getAttribute("data-pane-id")).toBe(paneId);
  expect(
    await browser.evaluate(async () => {
      const url = "/src/projects/api.ts";
      const projects = await import(/* @vite-ignore */ url);
      return projects.getActiveProject().id;
    }),
  ).toBe("one");
});

test("scheduled tasks stay project-scoped and the form fits 320px", async ({
  app,
  browser,
  screen,
}) => {
  await screen.getByRole("button", "Schedule event").tap();
  const form = screen.getByRole("dialog", "Schedule event");
  await form.getByLabel("Task name").fill("Other project task");
  await form.getByLabel("Instructions").fill("Summarize the project's state.");
  await form.getByRole("button", "Project", { exact: true }).tap();
  await screen.getByRole("menuitemradio", "Other project", { exact: true }).tap();
  await form.getByRole("button", "Agent", { exact: true }).tap();
  await screen.getByRole("menuitemradio", "Codex", { exact: true }).tap();
  await browser.setViewport({ width: 320, height: 720 });
  const fits = await browser.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Schedule event"]',
    )!;
    return dialog.scrollWidth <= dialog.clientWidth;
  });
  expect(fits).toBe(true);
  await app.screenshot("schedule-task-portrait");
  await form.getByRole("button", "Review schedule").tap();
  const review = screen.getByRole("dialog", "Review schedule");
  await review.getByRole("checkbox").check();
  await review.getByRole("button", "Activate schedule").tap();
  await expect(screen.getByRole("article", "Other project task")).toBeVisible();
  await browser.evaluate(async () => {
    const url = "/src/projects/api.ts";
    const projects = await import(/* @vite-ignore */ url);
    projects.switchProject("one");
  });
  await expect(screen.getByRole("article", "Other project task")).toHaveCount(0);
});
