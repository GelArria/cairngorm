import { test, expect } from "./fixtures";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "../..");
import { send, output as terminalOutput } from "./test-output-fixture";
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

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

test("captures an ESM browser script through its final screen without test-runner output", async ({
  app,
}) => {
  const id = await app.evaluate(
    () =>
      (window as any).__PTY_CALLS__.find((c: any) => c.cmd === "pty_ensure").args
        .sessionId as string,
  );
  const html = await readFile(path.join(root, "tests/e2e/fixtures/visual-app.html"));
  const website = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
  const baseURL = await listen(website);
  let delivery = Promise.resolve();
  const frames: { type: string; image?: string; url?: string }[] = [];
  const bridge = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const event = JSON.parse(Buffer.concat(chunks).toString());
    frames.push(event);
    // Native serde serializes empty optional fields as null.
    if (event.type === "closed") Object.assign(event, { image: null, url: null, title: null });
    delivery = delivery.then(() => send(app, `test-browser-${id}`, event));
    res.writeHead(204).end();
  });
  const endpoint = await listen(bridge);
  const preload = path.join(root, "src/testing/assets/playwright-preload.cjs").replace(/\\/g, "/");
  const child = spawn(process.execPath, ["tests/e2e/fixtures/visual-script.mjs"], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      CAIRNGORM_FIXTURE_URL: baseURL,
      CAIRNGORM_TEST_ENDPOINT: `${endpoint}/frame`,
      CAIRNGORM_TEST_TOKEN: "visual-test",
      // Not the inherited Cairngorm preload or its binary framing: only this one.
      CAIRNGORM_TEST_BINARY: "0",
      NODE_OPTIONS: `--require "${preload}"`,
    },
  });
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const completed = new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  try {
    expect(await completed, output).toBe(0);
    await delivery;
    await expect(app.getByTestId("test-browser-screen")).toBeVisible();
    await expect(app.getByTestId("test-browser-status")).toHaveText("Finished");
    await expect(app.getByRole("list", { name: "Walkthrough timeline" })).toContainText(
      "Fill · Email",
    );
    await expect(app.getByTestId("test-run-summary")).toContainText("Updated fields Email");
    expect(frames.some((f) => f.type === "activity")).toBe(true);
    await expect(app.getByLabel("Test browser page", { exact: true })).toContainText(
      `${baseURL}/checkout`,
    );
    expect(frames.some((f) => f.type === "frame" && f.url === `${baseURL}/checkout`)).toBe(true);
    expect(frames.some((f) => f.type === "frame" && (f as any).browserName === "chromium")).toBe(
      true,
    );
    await app.screenshot({ path: "logs/e2e/testing-app-script.png" });
  } finally {
    child.kill();
    await completed.catch(() => undefined);
    await delivery.catch(() => undefined);
    await close(bridge);
    await close(website);
  }
});

test("shows the actual app as a separate Playwright test clicks, fills and navigates", async ({
  app,
}) => {
  test.setTimeout(45000);
  const id = await app.evaluate(
    () =>
      (window as any).__PTY_CALLS__.find((c: any) => c.cmd === "pty_ensure").args
        .sessionId as string,
  );
  const html = await readFile(path.join(root, "tests/e2e/fixtures/visual-app.html"));
  const website = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
  const baseURL = await listen(website);
  let delivery = Promise.resolve();
  const frames: { type: string; pageId: string; image?: string; url?: string }[] = [];
  const bridge = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer visual-test") {
      res.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const event = JSON.parse(Buffer.concat(chunks).toString());
    frames.push(event);
    delivery = delivery.then(() => send(app, `test-browser-${id}`, event));
    res.writeHead(204).end();
  });
  const endpoint = await listen(bridge);
  const preload = path.join(root, "src/testing/assets/playwright-preload.cjs").replace(/\\/g, "/");
  const child = spawn(
    process.execPath,
    ["node_modules/playwright/cli.js", "test", "-c", "tests/playwright.stream.config.ts"],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        CAIRNGORM_FIXTURE_URL: baseURL,
        CAIRNGORM_TEST_ENDPOINT: `${endpoint}/frame`,
        CAIRNGORM_TEST_TOKEN: "visual-test",
        // Not the inherited Cairngorm preload or its binary framing: only this one.
        CAIRNGORM_TEST_BINARY: "0",
        NODE_OPTIONS: `--require "${preload}"`,
      },
    },
  );
  let output = "";
  const completed = new Promise<number | null>((resolve, reject) => {
    child.on("close", resolve);
    child.on("error", reject);
  });
  for (const pipe of [child.stdout, child.stderr])
    pipe.on("data", (data) => {
      output += data.toString();
      delivery = delivery.then(() => terminalOutput(app, id, data.toString()));
    });
  try {
    const pane = app.getByTestId("test-pane");
    await expect(app.getByTestId("test-browser-screen")).toBeVisible({ timeout: 20000 });
    await expect(app.getByTestId("test-browser-status")).toHaveText("Live");
    await expect(app.getByTestId("test-browser-screen")).toHaveAttribute(
      "alt",
      /customer buys a notebook/,
    );
    await expect(app.getByLabel("Test browser page", { exact: true })).toContainText(
      `${baseURL}/checkout`,
    );
    const timeline = app.getByRole("list", { name: "Walkthrough timeline" });
    await expect(timeline).toContainText("Click · Checkout");
    await expect(timeline.locator('[data-status="running"]')).toContainText("Wait");
    await expect(pane.getByTestId("test-run-summary")).toHaveCount(0);
    const walkthroughBox = (await pane.getByTestId("test-walkthrough-sidebar").boundingBox())!;
    const browserBox = (await pane.getByTestId("test-browser").boundingBox())!;
    expect(walkthroughBox.x).toBeGreaterThanOrEqual(browserBox.x + browserBox.width - 1);
    const initialWidth = (await app.getByTestId("test-browser").boundingBox())!.width;
    await pane.getByRole("button", { name: "Hide test sidebar", exact: true }).click();
    await expect(pane.getByTestId("test-walkthrough-sidebar")).toHaveCount(0);
    await expect(timeline).toHaveCount(0);
    expect((await app.getByTestId("test-browser").boundingBox())!.width).toBeGreaterThan(
      initialWidth,
    );
    await app.screenshot({ path: "logs/e2e/testing-walkthrough-focused.png" });
    await pane.getByRole("button", { name: "Show test sidebar", exact: true }).click();
    await expect(pane.getByTestId("test-walkthrough-sidebar")).toBeVisible();
    await app.screenshot({ path: "logs/e2e/testing-app-checkout.png" });
    await expect(app.getByLabel("Test browser page", { exact: true })).toContainText(
      `${baseURL}/receipt`,
    );
    await app.screenshot({ path: "logs/e2e/testing-app-live.png" });
    expect(await completed, output).toBe(0);
    await delivery;
    await expect(pane.getByText("Passed", { exact: true })).toBeVisible();
    await expect(app.getByTestId("test-browser-status")).toHaveText("Finished");
    await expect(timeline).toContainText("Fill · Email");
    await expect(timeline).toContainText("Click · Place order");
    await expect(timeline.locator('[data-status="running"]')).toHaveCount(0);
    const summary = pane.getByTestId("test-run-summary");
    await expect(summary).toContainText("Execution finished.");
    await expect(summary).toContainText("Updated fields Email");
    await expect(summary).toContainText("Place order");
    await expect(summary).toContainText("Tests: 1 passed, 0 failed, 0 skipped");
    const walkthrough = pane.getByTestId("test-walkthrough");
    await walkthrough.getByRole("button").click();
    await expect(timeline).toHaveCount(0);
    await walkthrough.getByRole("button").click();
    await expect(timeline).toBeVisible();
    expect(frames.filter((f) => f.type === "frame").length).toBeGreaterThan(3);
    expect(new Set(frames.map((f) => f.image).filter(Boolean)).size).toBeGreaterThan(2);
    await expect(app.getByTestId("test-browser-screen")).toBeVisible();
    const footer = pane.getByTestId("test-pane-footer");
    const footerBox = (await footer.boundingBox())!;
    const paneBox = (await pane.boundingBox())!;
    const reportBox = (await pane.getByTestId("test-run-report").boundingBox())!;
    expect(reportBox.width).toBe(paneBox.width);
    expect(reportBox.y).toBeGreaterThanOrEqual(
      (await pane.getByTestId("test-browser").boundingBox())!.y +
        (await pane.getByTestId("test-browser").boundingBox())!.height -
        1,
    );
    const sidebarBox = (await app.getByTestId("git-footer").boundingBox())!;
    expect(footerBox.width).toBe(paneBox.width);
    expect(Math.abs(footerBox.y - sidebarBox.y)).toBeLessThanOrEqual(1);
    await app.screenshot({ path: "logs/e2e/testing-app-finished.png" });
    await app.setViewportSize({ width: 620, height: 920 });
    await app.screenshot({ path: "logs/e2e/testing-app-narrow.png" });
    await app.setViewportSize({ width: 550, height: 360 });
    await expect
      .poll(async () => {
        const screen = (await app.getByTestId("test-browser").boundingBox())!;
        const image = (await app.getByTestId("test-browser-screen").boundingBox())!;
        const bottom = (await footer.boundingBox())!;
        return (
          image.height >= 40 &&
          screen.y + screen.height <= bottom.y + 1 &&
          bottom.y + bottom.height <= 361
        );
      })
      .toBe(true);
    await app.screenshot({ path: "logs/e2e/testing-app-short.png" });
    await app.setViewportSize({ width: 1440, height: 900 });
    await app.evaluate(async () => {
      const module = "/src/appearance/data/store.ts";
      const appearance = await import(/* @vite-ignore */ module);
      appearance.selectTheme("white");
    });
    await expect(app.locator("html")).toHaveAttribute("data-theme", "white");
    await app.screenshot({ path: "logs/e2e/testing-app-light.png", animations: "disabled" });
    await pane.getByRole("button", { name: "Output", exact: true }).click();
    await expect(pane.locator("pre")).toContainText("customer buys a notebook");
    await expect(footer).toContainText("Latest 600 lines");
  } finally {
    child.kill();
    await completed.catch(() => undefined);
    await delivery.catch(() => undefined);
    await close(bridge);
    await close(website);
  }
});
