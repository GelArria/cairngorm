import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import { spawn } from "node:child_process";

import { send, output } from "./test-output-fixture";

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

test("auto-opens live tests, streams results, filters, reuses and closes without killing the TUI", async ({
  app,
}) => {
  const id = await session(app);
  await output(app, id, "We should run npm test.\n");
  await expect(app.getByRole("tab")).toHaveCount(1);
  await output(
    app,
    id,
    "\x1b[32mRunning 3 tests using 1 worker\x1b[0m\n ✓ 1 [chromium] › auth.spec.ts › signs in (1s)\n",
  );
  const pane = app.getByTestId("test-pane");
  await expect(pane).toBeVisible();
  await expect(pane).toContainText("Running");
  await expect(pane.getByTestId("test-passed")).toHaveText("1 passed");
  await app.screenshot({ path: "logs/e2e/testing-running.png" });
  await output(app, id, " ✘ 2 [chromium] › auth.spec.ts › rejects expired session (1s)\n");
  await expect(pane.getByTestId("test-failed")).toHaveText("1 failed");
  await pane.getByRole("button", { name: "Failed only" }).click();
  await expect(pane.getByRole("list")).not.toContainText("signs in");
  await expect(pane.getByRole("list")).toContainText("expired session");
  await output(
    app,
    id,
    " ✓ 3 [chromium] › auth.spec.ts › signs out (1s)\n 1 failed\n 2 passed (3s)\n",
  );
  await expect(pane.getByTestId("test-passed")).toHaveText("2 passed");
  await expect(pane).toContainText("3 / 3 tests");
  await app.screenshot({ path: "logs/e2e/testing-failed.png" });
  await pane.getByRole("button", { name: "Output", exact: true }).click();
  await expect(pane.locator("pre")).toContainText("rejects expired session");
  await pane.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(pane).not.toBeVisible();
  await output(app, id, "Running 1 test using 1 worker\n");
  await expect(pane).toBeVisible();
  await expect(pane).toContainText("Running");
  await expect(pane.getByTestId("test-passed")).toHaveText("0 passed");
  await expect(app.getByRole("tab")).toHaveCount(2);
  await app.setViewportSize({ width: 550, height: 980 });
  await app.screenshot({ path: "logs/e2e/testing-narrow.png" });
  await app
    .getByRole("tab", { name: /^Tests ·/ })
    .locator("..")
    .getByRole("button", { name: "Close tab", exact: true })
    .click();
  await expect(app.getByRole("tab")).toHaveCount(1);
  await expect
    .poll(() =>
      app.evaluate(
        () => (window as any).__PTY_CALLS__.filter((c: any) => c.cmd === "pty_kill").length,
      ),
    )
    .toBe(0);
  await output(app, id, " ✓ 1 still running (1s)\n");
  await expect(app.getByRole("tab")).toHaveCount(1);
});

test("native agent cumulative tool updates do not duplicate results; tool errors finish the run", async ({
  app,
}) => {
  const id = await session(app);
  const base = { session_id: id, toolCallId: "test-1", toolName: "bash" };
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_start",
    args: { command: "npx vitest run" },
  });
  const first = " RUN v4.0.0 C:/repo\n ✓ auth.test.ts > signs in\n";
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_update",
    partialResult: { content: [{ type: "text", text: first }] },
  });
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_update",
    partialResult: {
      content: [{ type: "text", text: first + " × auth.test.ts > rejects password\n" }],
    },
  });
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_end",
    result: {
      content: [
        {
          type: "text",
          text: first + " × auth.test.ts > rejects password\n Tests 1 failed | 1 passed (2)\n",
        },
      ],
    },
    isError: true,
  });
  const pane = app.getByTestId("test-pane");
  await expect(pane).toContainText("Failed");
  await expect(pane.getByRole("list").getByRole("listitem")).toHaveCount(2);
  await expect(pane.getByTestId("test-passed")).toHaveText("1 passed");
  await expect(app.getByRole("tab")).toHaveCount(2);
});

test("summary-only runners and startup errors always show an execution result", async ({ app }) => {
  const id = await session(app);
  await output(app, id, " RUN v4.0.0 C:/repo\n Tests 2 passed (2)\n");
  const pane = app.getByTestId("test-pane");
  await expect(pane.getByTestId("test-execution-result")).toContainText("2 passed");
  await expect(pane.getByTestId("test-execution-result")).toContainText("Passed");
  await output(app, id, "Running 1 test using 1 worker\n1 passed (1s)\n");
  await expect(pane.getByTestId("test-execution-result")).toContainText(
    "Playwright execution · Passed",
  );
  await expect(pane.getByTestId("test-execution-result")).toContainText("1 passed");
  const base = { session_id: id, toolCallId: "startup-error", toolName: "bash" };
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_start",
    args: { command: "npx playwright test" },
  });
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_end",
    result: {
      content: [{ type: "text", text: "Error: browser executable missing" }],
      details: { exitCode: 1 },
    },
    isError: false,
  });
  await expect(pane.getByTestId("test-execution-result")).toContainText("Failed");
  await expect(pane.getByTestId("test-execution-result")).toContainText(
    "browser executable missing",
  );
  await expect(pane.getByTestId("test-passed")).toHaveText("0 passed");
  await expect(app.locator("[data-test-tab-flight]")).toHaveCount(0);
  await app.screenshot({ path: "logs/e2e/testing-execution-error.png" });
});

test("a custom test command with no output reports completion, not a fabricated pass", async ({
  app,
}) => {
  const id = await session(app);
  const base = { session_id: id, toolCallId: "custom-test", toolName: "bash" };
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_start",
    args: { command: "npm run test:custom" },
  });
  await send(app, "agent-event", {
    ...base,
    type: "tool_execution_end",
    result: { content: [], details: { exitCode: 0 } },
    isError: false,
  });
  const result = app.getByTestId("test-execution-result");
  await expect(result).toContainText("Tests execution · Finished");
  await expect(result).toContainText("npm run test:custom");
  await expect(result).toContainText("No individual test results were reported");
  await expect(app.getByTestId("test-passed")).toHaveText("0 passed");
});

test("a testing tab flies from its requesting pane, not the selected neighbor", async ({ app }) => {
  await app.emulateMedia({ reducedMotion: "no-preference" });
  const id = await session(app);
  const sourceTab = app.getByRole("tab", { selected: true });
  const sourceId = (await sourceTab.locator("..").getAttribute("data-tab-id"))!;
  await sourceTab.click({ button: "right" });
  await app.getByRole("menuitem", { name: "Split right", exact: true }).click();
  await expect(app.getByRole("tab")).toHaveCount(2);
  const origin = (await app.locator(`[data-pane-id="${sourceId}"]`).boundingBox())!;
  await app.evaluate(
    async ({ id }) => {
      const backend = await import(/* @vite-ignore */ "/tests/mocks/pty-test-observer.ts");
      await backend.output(id, " RUN v4.0.0 C:/repo\n");
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          document.getAnimations().forEach((animation) => {
            animation.pause();
            animation.currentTime = 180;
          });
          resolve();
        }),
      );
    },
    { id },
  );
  const ghost = app.locator(`[data-test-tab-flight="${sourceId}"]`);
  await expect(ghost).toBeVisible();
  const transform = await ghost.evaluate(
    (el) => (el.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].transform,
  );
  const destination = (await app
    .getByRole("tab", { name: /^Tests ·/ })
    .locator("..")
    .boundingBox())!;
  const dx = origin.x + origin.width / 2 - destination.x - destination.width / 2;
  const dy = origin.y + Math.min(64, origin.height / 2) - destination.y;
  const translation = String(transform).match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!;
  expect(Number(translation[1])).toBeCloseTo(dx, 2);
  expect(Number(translation[2])).toBeCloseTo(dy, 2);
  await app.screenshot({ path: "logs/e2e/testing-tab-flight.png" });
  await app.evaluate(() => document.getAnimations().forEach((animation) => animation.play()));
  await expect(ghost).toHaveCount(0);
  await output(app, id, " Tests 1 passed (1)\n RUN v4.0.0 C:/repo\n");
  await expect(app.locator("[data-test-tab-flight]")).toHaveCount(0);
  await expect(app.getByRole("tab")).toHaveCount(3);
});

test("reduced motion opens the testing tab without a flying clone", async ({ app }) => {
  await app.emulateMedia({ reducedMotion: "reduce" });
  await output(app, await session(app), " RUN v4.0.0 C:/repo\n Tests 1 passed (1)\n");
  await expect(app.getByTestId("test-execution-result")).toContainText("1 passed");
  await expect(app.locator("[data-test-tab-flight]")).toHaveCount(0);
});

test("renders an actual Vitest subprocess stream through the terminal event path", async ({
  app,
}) => {
  const id = await session(app);
  const child = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "tests/unit/test-detection.test.ts",
      "--reporter=verbose",
    ],
    { env: { ...process.env, FORCE_COLOR: "1" } },
  );
  let delivery = Promise.resolve();
  let actualOutput = "";
  const pipe = (data: Buffer) => {
    actualOutput += data.toString();
    delivery = delivery.then(() => output(app, id, data.toString()));
  };
  child.stdout.on("data", pipe);
  child.stderr.on("data", pipe);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("exit", resolve);
      child.on("error", reject);
    });
    await delivery;
    expect(code).toBe(0);
    const pane = app.getByTestId("test-pane");
    await expect(pane).toBeVisible();
    await expect(pane).toContainText("Vitest");
    const plain = actualOutput.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
    const finalCount = [...plain.matchAll(/Tests\s+(\d+) passed/g)].at(-1)![1];
    await expect(pane.getByTestId("test-passed")).toHaveText(`${finalCount} passed`);
    await expect(pane.getByRole("heading", { level: 2 })).toHaveText("Vitest");
    await expect(pane.getByText("Passed", { exact: true })).toBeVisible();
    await expect(pane.getByRole("list")).not.toContainText("[chromium]");
    await send(app, `pty-exit-${id}`, {});
    await expect(pane.getByText("Passed", { exact: true })).toBeVisible();
    await app.screenshot({ path: "logs/e2e/testing-real-vitest.png" });
  } finally {
    child.kill();
  }
});
