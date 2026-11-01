import { test, expect } from "./fixtures";
import { output, send } from "./test-output-fixture";

// Exercise the real auto-open path; only the native PTY transport is mocked.
test.beforeEach(async ({ app }) => {
  await app.addInitScript(() => {
    localStorage.setItem("show-splash", "false");
    const api = (window as any).__TAURI_INTERNALS__,
      original = api.invoke;
    api.invoke = async (cmd: string, args: any) => {
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

test("keeps the existing views and rows, with searchable results and legible narrow layouts", async ({
  app,
}) => {
  const id = await app.evaluate(
    () =>
      (window as any).__PTY_CALLS__.find((c: any) => c.cmd === "pty_ensure").args
        .sessionId as string,
  );
  await output(
    app,
    id,
    "Running 6 tests using 1 worker\n ✓ 1 [chromium] › auth.spec.ts › signs in with valid credentials (1s)\n",
  );
  const pane = app.getByTestId("test-pane");
  await expect(pane).toContainText("Running");
  await output(
    app,
    id,
    " ✓ 2 [chromium] › auth.spec.ts › signs out and clears the session (1s)\n ✘ 3 [chromium] › checkout.spec.ts › rejects an expired session before placing an order (1s)\n ✓ 4 [chromium] › checkout.spec.ts › preserves items after navigating back (1s)\n - 5 [webkit] › checkout.spec.ts › applies a discount\n ✓ 6 [chromium] › settings.spec.ts › saves notification preferences (1s)\n 1 failed\n 1 skipped\n 4 passed (6s)\n",
  );
  const list = pane.getByRole("list", { name: "Detected test results" });
  await expect(list.getByRole("listitem")).toHaveCount(6);
  await expect(pane.getByRole("group", { name: "Test view" }).getByRole("button")).toHaveCount(4);
  await expect(app.getByRole("tab")).toHaveCount(2);
  await expect(pane.getByRole("button", { name: "Results", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(pane.getByTestId("test-passed")).toHaveText("4 passed");
  await expect(app.locator("[data-test-tab-flight]")).toHaveCount(0);
  await app.screenshot({ path: "logs/e2e/testing-redesign-results-dark.png" });

  const failed = pane.getByRole("button", { name: "Failed only", exact: true });
  await failed.focus();
  await app.keyboard.press("Enter");
  await expect(failed).toHaveAttribute("aria-pressed", "true");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  const search = pane.getByRole("textbox", { name: "Filter tests" });
  await search.fill("missing");
  await expect(pane.getByText("No matching results.", { exact: true })).toBeVisible();
  await search.fill("expired");
  await expect(list).toContainText("rejects an expired session");
  await failed.click();
  await search.fill("");

  await app.evaluate(async () => {
    const module = "/src/appearance/data/store.ts";
    (await import(/* @vite-ignore */ module)).selectTheme("white");
  });
  await expect(app.locator("html")).toHaveAttribute("data-theme", "white");
  await pane.getByRole("heading", { level: 2 }).click();
  await app.screenshot({
    path: "logs/e2e/testing-redesign-results-light.png",
    animations: "disabled",
  });
  await app.setViewportSize({ width: 550, height: 700 });
  for (const control of [
    search,
    failed,
    pane.getByRole("button", { name: "Output", exact: true }),
    pane.getByRole("button", { name: "Terminal", exact: true }),
  ]) {
    const box = (await control.boundingBox())!;
    const bounds = (await pane.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await app.screenshot({
    path: "logs/e2e/testing-redesign-results-narrow.png",
    animations: "disabled",
  });
  await pane.getByRole("button", { name: "Output", exact: true }).click();
  await expect(pane.locator("pre")).toContainText("rejects an expired session");
});

test("distinguishes pending browser actions and failed steps without adding timeline entries", async ({
  app,
}) => {
  const id = await app.evaluate(
    () =>
      (window as any).__PTY_CALLS__.find((c: any) => c.cmd === "pty_ensure").args
        .sessionId as string,
  );
  await output(app, id, "Running 1 test using 1 worker\n");
  const website = await app.context().newPage();
  await website.goto("/tests/e2e/fixtures/visual-app.html");
  const image = (await website.screenshot({ type: "jpeg" })).toString("base64");
  await website.close();
  await send(app, `test-browser-${id}`, {
    type: "frame",
    pageId: "checkout",
    timestamp: Date.now(),
    image,
    width: 1440,
    height: 900,
    url: "https://shop.test/checkout",
    title: "Checkout",
  });
  const startedAt = Date.now();
  for (const [index, label, status] of [
    [0, "Navigate · https://shop.test/checkout", "completed"],
    [1, "Fill · Email", "completed"],
    [2, "Click · Place order", "failed"],
    [3, "Wait · Confirmation", "running"],
  ] as const) {
    await send(app, `test-browser-${id}`, {
      type: "activity",
      pageId: "checkout",
      activityId: String(index),
      label,
      status,
      startedAt: startedAt + index * 1000,
      timestamp: startedAt + index * 1000 + 350,
    });
  }
  const pane = app.getByTestId("test-pane");
  const timeline = pane.getByRole("list", { name: "Walkthrough timeline" });
  await expect(timeline.getByRole("listitem")).toHaveCount(4);
  await expect(timeline.locator('[data-status="running"]')).toContainText("Now");
  await expect(timeline.locator('[data-status="failed"]')).toContainText("Failed");
  await expect(app.locator("[data-test-tab-flight]")).toHaveCount(0);
  await app.screenshot({ path: "logs/e2e/testing-redesign-app.png" });
  await pane.getByRole("button", { name: "Hide test sidebar", exact: true }).click();
  await expect(timeline).toHaveCount(0);
  await pane.getByRole("button", { name: "Show test sidebar", exact: true }).click();
  await expect(timeline.getByRole("listitem")).toHaveCount(4);
});
