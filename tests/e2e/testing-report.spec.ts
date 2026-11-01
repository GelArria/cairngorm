import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

import { send, output } from "./test-output-fixture";
const activity = (
  app: Page,
  id: string,
  activityId: string,
  label: string,
  status: string,
  pageId = "checkout",
) =>
  send(app, `test-browser-${id}`, {
    type: "activity",
    pageId,
    activityId,
    label,
    status,
    startedAt: 1000,
    timestamp: 2000,
  });

test.beforeEach(async ({ app }) => {
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd.startsWith("pty_")) {
        ((window as any).__PTY_CALLS__ ??= []).push({ cmd, args });
        return cmd === "pty_replay" ? null : undefined;
      }
      if (cmd === "detect_home") return "C:/repo";
      return original(cmd, args);
    };
  });
  await app.reload();
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal" })
    .click();
  await expect
    .poll(() =>
      app.evaluate(() => (window as any).__PTY_CALLS__?.some((c: any) => c.cmd === "pty_ensure")),
    )
    .toBe(true);
});

async function start(app: Page) {
  const id = await app.evaluate(
    () =>
      (window as any).__PTY_CALLS__.find((c: any) => c.cmd === "pty_ensure").args
        .sessionId as string,
  );
  const website = await app.context().newPage();
  await website.goto("/tests/e2e/fixtures/visual-app.html");
  const image = (
    await website.screenshot({ type: "jpeg", path: "logs/e2e/testing-fixture-shop.jpg" })
  ).toString("base64");
  await website.close();
  await output(app, id, "Running 2 tests using 1 worker\n");
  const frame = (pageId: string) =>
    send(app, `test-browser-${id}`, {
      type: "frame",
      pageId,
      timestamp: Date.now(),
      image,
      width: 1440,
      height: 900,
      url: `https://shop.test/${pageId}`,
      title: pageId,
    });
  await frame("checkout");
  return { id, frame, pane: app.getByTestId("test-pane") };
}

test("keeps errors below the app and summarizes all pages after the walkthrough finishes", async ({
  app,
}) => {
  const { id, frame, pane } = await start(app);
  await activity(app, id, "navigate", "Navigate · https://shop.test/checkout", "completed");
  await activity(app, id, "email", "Fill · Email", "completed");
  await activity(app, id, "order", "Click · Place order", "running");
  await expect(pane.getByTestId("test-run-summary")).toHaveCount(0);
  await activity(app, id, "order", "Click · Place order", "failed");
  await output(
    app,
    id,
    "Error: checkout timed out\n  at checkout.spec.ts:12\n\n ✘ 1 checkout rejects unavailable stock (1s)\n",
  );
  const errors = pane.getByRole("list", { name: "Test errors" });
  await expect(errors).toContainText("Failed action · Click · Place order");
  await expect(errors).toContainText("at checkout.spec.ts:12");
  await expect(pane.getByTestId("test-run-summary")).toHaveCount(0);
  await pane.getByRole("button", { name: "Hide test sidebar", exact: true }).click();
  await expect(pane.getByTestId("test-walkthrough-sidebar")).toHaveCount(0);
  await expect(errors).toBeVisible();
  await app.screenshot({ path: "logs/e2e/testing-errors-running.png" });
  await pane.getByRole("button", { name: "Show test sidebar", exact: true }).click();
  await frame("receipt");
  await activity(app, id, "continue", "Click · Continue", "completed", "receipt");
  await activity(app, id, "wait", "Wait", "running", "receipt");
  await output(app, id, " ✓ 2 receipt renders (1s)\n 1 failed\n 1 passed (2s)\n");
  await expect(pane.getByText("Failed", { exact: true }).first()).toBeVisible();
  await expect(pane.getByTestId("test-run-summary")).toHaveCount(0);
  await activity(app, id, "wait", "Wait", "completed", "receipt");
  const summary = pane.getByTestId("test-run-summary");
  await expect(summary).toContainText("Execution finished with errors.");
  await expect(summary).toContainText("Updated fields Email.");
  await expect(summary).toContainText("Clicked Continue.");
  await expect(summary).toContainText("2 browser pages");
  await expect(summary).toContainText("Tests: 1 passed, 1 failed, 0 skipped");
  await expect(summary).not.toContainText("Clicked Place order");
  const reportBox = (await pane.getByTestId("test-run-report").boundingBox())!;
  const browserBox = (await pane.getByTestId("test-browser").boundingBox())!;
  expect(reportBox.y).toBeGreaterThanOrEqual(browserBox.y + browserBox.height - 1);
  expect(reportBox.width).toBe((await pane.boundingBox())!.width);
  await pane
    .getByRole("tablist", { name: "Test browser pages" })
    .getByRole("tab", { name: /checkout$/ })
    .click();
  await expect(pane.getByRole("list", { name: "Walkthrough timeline" })).toContainText(
    "Fill · Email",
  );
  await expect(pane.getByRole("list", { name: "Walkthrough timeline" })).not.toContainText(
    "Continue",
  );
  await expect(summary).toContainText("Clicked Continue.");
  await app.screenshot({ path: "logs/e2e/testing-report-errors.png" });
  await pane.getByRole("button", { name: "See Output", exact: true }).click();
  await expect(pane.locator("pre")).toContainText("Error: checkout timed out");
  await pane.getByRole("button", { name: "App", exact: true }).click();
  await output(app, id, "Running 1 test using 1 worker\n");
  await expect(pane.getByTestId("test-run-report")).toHaveCount(0);
  await frame("new-run");
  await expect(pane.getByRole("list", { name: "Walkthrough timeline" })).toHaveCount(0);
  await expect(pane.getByTestId("test-walkthrough")).not.toContainText("Place order");
});

test("reports an interrupted run without claiming its pending step succeeded", async ({ app }) => {
  const { id, pane } = await start(app);
  await activity(app, id, "email", "Fill · Email", "completed");
  await activity(app, id, "order", "Click · Place order", "running");
  await send(app, `pty-exit-${id}`, {});
  const summary = pane.getByTestId("test-run-summary");
  await expect(summary).toContainText("Execution was interrupted.");
  await expect(pane.getByTestId("test-run-report")).toContainText("Interrupted walkthrough");
  await expect(pane.getByTestId("test-run-report")).not.toContainText("Completed walkthrough");
  await expect(summary).toContainText("Updated fields Email.");
  await expect(summary).toContainText("1 step did not complete.");
  await expect(summary).not.toContainText("Clicked Place order");
  await expect(
    pane.getByRole("list", { name: "Walkthrough timeline" }).locator('[data-status="interrupted"]'),
  ).toContainText("Place order");
  await app.screenshot({ path: "logs/e2e/testing-report-interrupted.png" });
});
