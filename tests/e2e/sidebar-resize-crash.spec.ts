import { test, expect } from "./fixtures";

test("Git footer and sidebar collapse do not produce resize-loop errors", async ({ app }) => {
  await app.evaluate(() => {
    (window as any).__RESIZE_ERRORS__ = [];
    window.addEventListener("error", (e) => {
      if (e.message.startsWith("ResizeObserver loop"))
        (window as any).__RESIZE_ERRORS__.push(e.message);
    });
  });
  await app.getByTestId("git-footer").click();
  await app
    .getByTestId("git-commit-message")
    .fill("A commit message that wraps onto several lines in the sidebar. ".repeat(5));
  for (let i = 0; i < 5; i++) {
    await app.getByTestId("sidebar-collapse").click();
    await app.getByTestId("sidebar-expand").click();
  }
  await expect.poll(() => app.evaluate(() => (window as any).__RESIZE_ERRORS__)).toEqual([]);
  await expect(app.getByText("Crash Report", { exact: true })).toHaveCount(0);
  await app.screenshot({ path: "logs/e2e/sidebar-resize-fixed.png" });
});

test("browser resize notifications are nonfatal, real JS errors still show a report", async ({
  app,
}) => {
  for (const message of [
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ]) {
    await app.evaluate(
      (message) => window.dispatchEvent(new ErrorEvent("error", { message })),
      message,
    );
    await expect(app.getByText("Crash Report", { exact: true })).toHaveCount(0);
  }
  await app.evaluate(() =>
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "Real application failure",
        error: new Error("Real application failure"),
      }),
    ),
  );
  await expect(app.getByText("Crash Report", { exact: true })).toBeVisible();
  await expect(app.getByText("Real application failure", { exact: true })).toBeVisible();
});
