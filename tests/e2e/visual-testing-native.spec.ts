import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

test("a real terminal inherits the observer and streams Playwright into native Cairngorm", async () => {
  test.skip(
    test.info().config.metadata.nativeVisualTesting !== true,
    "Use tests/playwright.visual-native.config.ts with native Cairngorm running",
  );
  const root = path.resolve(import.meta.dirname, "../..");
  const html = await readFile(path.join(root, "tests/e2e/fixtures/visual-app.html"));
  const website = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  });
  await new Promise<void>((resolve) => website.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(website.address() as { port: number }).port}`;
  const browser = await chromium.connectOverCDP(
    process.env.NATIVE_CDP_URL ?? "http://127.0.0.1:9222",
  );
  const app = browser
    .contexts()[0]
    .pages()
    .find((p) => p.url() === "http://localhost:1420/");
  if (!app) throw new Error("Native Cairngorm main window not found");
  const project = await app.evaluate(async (root) => {
    const module = "/src/projects/api.ts";
    const store = await import(/* @vite-ignore */ module);
    const previous = store.getProjectsState().activeId;
    const project = store.createProject(root, "Visual testing QA");
    return { id: project.id, previous };
  }, root);
  try {
    await app
      .getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await app
      .getByRole("menuitem", { name: /^PowerShell/ })
      .first()
      .click();
    const terminal = app.locator(".xterm-helper-textarea").first();
    await expect(terminal).toBeVisible();
    await expect
      .poll(() => app.locator(".xterm-rows").first().innerText(), { timeout: 15000 })
      .toContain("Cairngorm-devbuild");
    await app.evaluate(async () => {
      const tabsModule = "/src/terminal/hooks/use-terminal-tabs.ts";
      const eventModule = "/node_modules/@tauri-apps/api/event.js";
      const { getTerminalTab } = await import(/* @vite-ignore */ tabsModule);
      const { listen } = await import(/* @vite-ignore */ eventModule);
      const frames: { image: unknown; imageId: string; payloadBytes: number }[] = [];
      (window as any).__QA_BROWSER_FRAMES__ = frames;
      (window as any).__QA_UNLISTEN_FRAMES__ = await listen(
        `test-browser-${getTerminalTab().sessionId}`,
        ({ payload }: any) => {
          if (payload.type === "frame" && frames.length < 50)
            frames.push({
              image: payload.image,
              imageId: payload.imageId,
              payloadBytes: JSON.stringify(payload).length,
            });
        },
      );
    });
    const command = `node -e "process.env.CAIRNGORM_FIXTURE_URL='${url}'; process.argv=['node','playwright','test','-c','tests/playwright.stream.config.ts']; require('./node_modules/playwright/cli.js')"`;
    await app.evaluate(async (command) => {
      const tabsModule = "/src/terminal/hooks/use-terminal-tabs.ts";
      const coreModule = "/node_modules/@tauri-apps/api/core.js";
      const tabs = await import(/* @vite-ignore */ tabsModule);
      const { invoke } = await import(/* @vite-ignore */ coreModule);
      await invoke("pty_write", {
        sessionId: tabs.getTerminalTab().sessionId,
        data: " " + command + "\r",
      });
    }, command);
    await expect(app.getByTestId("test-browser-screen")).toBeVisible({ timeout: 25000 });
    await expect(app.getByTestId("test-browser-status")).toHaveText("Live");
    const screen = app.getByTestId("test-browser-screen");
    await expect
      .poll(() =>
        screen.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    expect(await screen.getAttribute("src")).toMatch(
      /^http:\/\/test-frame\.localhost\/[a-f0-9-]+\?t=\d+$/,
    );
    await expect(app.getByLabel("Test browser page", { exact: true })).toContainText(
      `${url}/receipt`,
    );
    await app.screenshot({ path: "logs/e2e/testing-app-native-live.png" });
    await expect(app.getByTestId("test-pane").getByText("Passed", { exact: true })).toBeVisible();
    await expect(app.getByTestId("test-browser-status")).toHaveText("Finished");
    await expect(app.getByTestId("test-browser-screen")).toBeVisible();
    await expect
      .poll(() =>
        screen.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
      )
      .toBe(true);
    await app.screenshot({ path: "logs/e2e/testing-app-native-finished.png" });
    const frames = await app.evaluate(() => (window as any).__QA_BROWSER_FRAMES__);
    expect(frames.length).toBeGreaterThan(0);
    expect(
      frames.every(
        (frame: any) =>
          !frame.image && /^[a-f0-9-]{36}$/.test(frame.imageId) && frame.payloadBytes < 32768,
      ),
    ).toBe(true);
    await writeFile(
      "logs/optimization-phase2-frame-metadata.json",
      JSON.stringify(frames, null, 2),
    );
    console.log(
      `PASS: ${frames.length} native frames contain no base64; max metadata ${Math.max(...frames.map((f: any) => f.payloadBytes))} characters; live and finished JPEG decoded`,
    );
  } catch (error) {
    await app.screenshot({ path: "logs/e2e/testing-app-native-error.png" });
    const output = await app.locator(".xterm-rows").first().innerText();
    await writeFile("logs/e2e/testing-app-native-terminal.txt", output);
    await test.info().attach("terminal-output", { body: output, contentType: "text/plain" });
    throw error;
  } finally {
    await app
      .evaluate(() => {
        (window as any).__QA_UNLISTEN_FRAMES__?.();
      })
      .catch(() => {});
    const closes = app.getByRole("button", { name: "Close tab", exact: true });
    while (await closes.count()) await closes.last().click();
    await app.evaluate(async ({ id, previous }) => {
      const module = "/src/projects/api.ts";
      const store = await import(/* @vite-ignore */ module);
      if (previous) store.switchProject(previous);
      store.removeProject(id);
    }, project);
    await browser.close();
    await new Promise<void>((resolve) => website.close(() => resolve()));
  }
});
