import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { output } from "./test-output-fixture";

const RUN = "Running 2 tests using 1 worker\n ✓ 1 [chromium] › auth.spec.ts › signs in (1s)\n";

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

async function session(app: Page) {
  return app.evaluate(
    () =>
      (window as any).__PTY_CALLS__.find((c: any) => c.cmd === "pty_ensure").args
        .sessionId as string,
  );
}

test("toggle off stops test views from opening and saves the choice", async ({ app }) => {
  const toggle = app.getByTestId("header-test-auto-open");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(app.getByTestId("test-auto-open-choice")).toHaveCount(0);

  await output(
    app,
    await session(app),
    `${RUN} ✓ 2 [chromium] › a.spec.ts › b (1s)\n 2 passed (2s)\n`,
  );
  await app.waitForTimeout(500);
  await expect(app.getByRole("tab")).toHaveCount(1);
  await expect(app.getByTestId("test-pane")).toHaveCount(0);
  expect(await app.evaluate(() => localStorage.getItem("tests-auto-open"))).toBe("false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await output(app, await session(app), "Running 1 test using 1 worker\n");
  await expect(app.getByTestId("test-pane")).toBeVisible();
});

test("turning off with an open view can keep it updating without reopening it", async ({ app }) => {
  const id = await session(app);
  await output(app, id, RUN);
  const pane = app.getByTestId("test-pane");
  await expect(pane).toBeVisible();

  await app.getByTestId("header-test-auto-open").click();
  const choice = app.getByTestId("test-auto-open-choice");
  await expect(choice).toContainText("1 test view is open.");
  await app.screenshot({ path: "logs/e2e/test-auto-open-choice.png" });
  await choice.getByText("Keep showing open views").click();
  await expect(app.getByTestId("header-test-auto-open")).toHaveAttribute("aria-pressed", "false");
  await expect(pane.getByTestId("test-passed")).toHaveText("1 passed");

  // Back to the terminal: a new run updates the kept view but does not bring it forward.
  await pane.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(pane).not.toBeVisible();
  await output(app, id, "Running 1 test using 1 worker\n ✓ 1 [chromium] › a.spec.ts › b (1s)\n");
  await app.waitForTimeout(500);
  await expect(pane).not.toBeVisible();
  await expect(app.getByRole("tab")).toHaveCount(2);
});

test("turning off with an open view can hide it", async ({ app }) => {
  await output(app, await session(app), RUN);
  await expect(app.getByTestId("test-pane")).toBeVisible();
  await expect(app.getByRole("tab")).toHaveCount(2);

  await app.getByTestId("header-test-auto-open").click();
  await app.getByTestId("test-auto-open-choice").getByText("Hide open test views").click();
  await expect(app.getByTestId("test-pane")).toBeHidden();
  await expect(app.getByRole("tab")).toHaveCount(1);
  await expect(app.getByTestId("header-test-auto-open")).toHaveAttribute("aria-pressed", "false");
  await expect(app.locator("[data-test-tab-flight]")).toHaveCount(0);
  await app.screenshot({ path: "logs/e2e/test-auto-open-hidden.png" });
});
