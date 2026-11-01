import { test, expect } from "./fixtures";
import { send, output } from "./test-output-fixture";

test("a finished visual script followed by Vitest clears browser state and returns to results", async ({
  app,
}) => {
  await app
    .getByTestId("project-terminals-empty")
    .getByRole("button", { name: "New terminal" })
    .click();
  await expect(app.locator(".xterm")).toBeVisible();
  const id = await app.evaluate(async () => {
    const tabs = await import(/* @vite-ignore */ "/src/terminal/hooks/use-terminal-tabs.ts");
    return tabs.getTerminalTab().sessionId;
  });
  const website = await app.context().newPage();
  await website.goto("/tests/e2e/fixtures/visual-app.html");
  const image = (await website.screenshot({ type: "jpeg" })).toString("base64");
  await website.close();
  await send(app, `test-browser-${id}`, {
    type: "frame",
    pageId: "checkout",
    timestamp: 1,
    image,
    width: 1440,
    height: 900,
    title: "Checkout",
  });
  await expect(app.getByTestId("test-browser-screen")).toBeVisible();
  await send(app, `test-browser-${id}`, { type: "closed", pageId: "checkout", timestamp: 2 });
  await expect(app.getByTestId("test-browser-status")).toHaveText("Finished");
  await output(app, id, " RUN v4.0.0 /repo\n Tests 1 passed (1)\n");
  const pane = app.getByTestId("test-pane");
  await expect(pane.getByRole("heading", { name: "Vitest", exact: true })).toBeVisible();
  await expect(pane.getByTestId("test-execution-result")).toContainText("1 passed");
  await expect(pane.getByRole("button", { name: "Results", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(pane.getByRole("button", { name: "App", exact: true })).toHaveCount(0);
  await expect(app.getByTestId("test-browser-screen")).toHaveCount(0);
  await app.screenshot({ path: "logs/e2e/testing-visual-to-vitest.png" });
});
