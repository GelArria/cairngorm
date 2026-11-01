import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:http";
import path from "node:path";
import { writeFile } from "node:fs/promises";

test("native test browser navigates, reloads, hides with its panel and releases the webview", async () => {
  test.skip(
    test.info().config.metadata.nativeBrowserPreview !== true,
    "Use tests/playwright.browser-native.config.ts with native Cairngorm running",
  );
  let requests = 0;
  const website = createServer((req, res) => {
    requests++;
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "DENY"); // A native webview must work without iframe embedding permission.
    res.end(`<!doctype html><title>Preview ${req.url}</title><style>body{font:18px system-ui;padding:32px;background:#f6f3ed;color:#252a24}a{color:#293b28}</style>
      <h1>${req.url === "/next" ? "Second page" : "Local preview"}</h1><a href="/next">Continue</a><input aria-label="Note" placeholder="Type a note">`);
  });
  await new Promise<void>((resolve) => website.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(website.address() as { port: number }).port}`;
  const browser = await chromium.connectOverCDP(
    process.env.NATIVE_CDP_URL ?? "http://127.0.0.1:9222",
  );
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  const app = pages().find((page) => page.url() === "http://localhost:1420/");
  if (!app) throw new Error("Native Cairngorm main window not found");
  const project = await app.evaluate(
    async (root) => {
      const store = await import(/* @vite-ignore */ "/src/projects/api.ts");
      const previous = store.getProjectsState().activeId;
      return { id: store.createProject(root, "Browser QA").id, previous };
    },
    path.resolve(import.meta.dirname, "../.."),
  );
  try {
    await app
      .getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await app
      .getByRole("menuitem", { name: /^PowerShell/ })
      .first()
      .click();
    await expect(app.locator(".xterm-helper-textarea").first()).toBeVisible();
    await app
      .locator("[data-pane-id]")
      .first()
      .click({ button: "right", position: { x: 150, y: 100 } });
    await app.getByRole("menuitem", { name: "Open test browser", exact: true }).click();
    const pane = app.getByTestId("test-pane"),
      preview = pane.getByTestId("browser-preview");
    await expect(preview).toBeVisible();
    await preview.getByRole("textbox", { name: "Browser address" }).fill(url);
    await preview.getByRole("button", { name: "Go", exact: true }).click();
    await expect
      .poll(() => pages().some((page) => page.url() === `${url}/`), { timeout: 15000 })
      .toBe(true);
    const child = pages().find((page) => page.url() === `${url}/`)!;
    await expect(child.getByRole("heading", { name: "Local preview" })).toBeVisible();
    const access = await child.evaluate(async () => {
      const api = (window as any).__TAURI_INTERNALS__;
      if (!api) return "No application bridge";
      try {
        await api.invoke("is_debug", {});
        return "allowed";
      } catch (error) {
        return String(error);
      }
    });
    expect(access).toMatch(/unavailable in browser previews|No application bridge/);
    await child.getByRole("textbox", { name: "Note" }).fill("A real native browser");
    await app.evaluate(async () => {
      const tabsUrl = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => url.includes("/src/terminal/hooks/use-terminal-tabs.ts"))
        .at(-1)!;
      const { getTerminalTabs } = await import(/* @vite-ignore */ tabsUrl);
      const source = getTerminalTabs().find((tab: any) => !tab.kind);
      const { invoke } = await import(/* @vite-ignore */ "/node_modules/@tauri-apps/api/core.js");
      await invoke("pty_write", {
        sessionId: source.sessionId,
        data: " Write-Output 'Running 1 test using 1 worker'\r",
      });
    });
    await expect(pane.getByRole("heading", { name: "Playwright", exact: true })).toBeVisible();
    await expect(preview).toBeVisible();
    expect(child.isClosed()).toBe(false);
    await expect(child.getByRole("textbox", { name: "Note" })).toHaveValue("A real native browser");
    await child.getByRole("link", { name: "Continue" }).click();
    await expect(preview.getByRole("textbox", { name: "Browser address" })).toHaveValue(
      `${url}/next`,
    );
    await expect(child.getByRole("heading", { name: "Second page" })).toBeVisible();
    await preview.getByRole("button", { name: "Back in preview" }).click();
    await expect(child.getByRole("heading", { name: "Local preview" })).toBeVisible();
    await preview.getByRole("button", { name: "Forward in preview" }).click();
    await expect(child.getByRole("heading", { name: "Second page" })).toBeVisible();
    const before = requests;
    await preview.getByRole("button", { name: "Reload preview" }).click();
    await expect.poll(() => requests > before).toBe(true);
    await expect(child.getByRole("heading", { name: "Second page" })).toBeVisible();
    // A multi-webview main window must retain the terminal detach/reattach transport.
    await app.evaluate(async () => {
      const { invoke } = await import(/* @vite-ignore */ "/node_modules/@tauri-apps/api/core.js");
      await invoke("emit_terminal_event", {
        target: "main",
        event: "terminal-detached-state",
        payload: {},
      });
    });
    await child.screenshot({ path: "logs/e2e/browser-preview-native-page.png" });
    await app.screenshot({ path: "logs/e2e/browser-preview-native-controls.png" });
    // Invalid input must report an error without navigating the current browser.
    await preview.getByRole("textbox", { name: "Browser address" }).fill("file:///C:/secret");
    await preview.getByRole("button", { name: "Go", exact: true }).click();
    await expect(preview.getByRole("alert")).toContainText("Only HTTP and HTTPS");
    expect(child.url()).toBe(`${url}/next`);
    await preview.getByRole("button", { name: "Live tests", exact: true }).click();
    await expect.poll(() => child.isClosed()).toBe(true);
    await expect(pane.getByTestId("test-browser")).toBeVisible();
    // Dynamically created detached windows inherit main's WebView2 arguments too.
    const detachedUrl = await app.evaluate(async () => {
      const tabsUrl = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => url.includes("/src/terminal/hooks/use-terminal-tabs.ts"))
        .at(-1)!;
      const { getTerminalTabs } = await import(/* @vite-ignore */ tabsUrl);
      const source = getTerminalTabs().find((tab: any) => !tab.kind);
      const { detachTerminalWindow } = await import(
        /* @vite-ignore */ "/src/terminal/data/terminal-window.ts"
      );
      const win = await detachTerminalWindow([{ ...source, id: "browser-preview-qa" }]);
      if (!win) throw new Error("Detached browser QA window could not be created");
      return "detached=browser-preview-qa";
    });
    await expect.poll(() => pages().some((page) => page.url().includes(detachedUrl))).toBe(true);
    const detached = pages().find((page) => page.url().includes(detachedUrl))!;
    const previewId = crypto.randomUUID();
    try {
      await detached.evaluate(
        async ({ previewId, url }) => {
          const { invoke } = await import(
            /* @vite-ignore */ "/node_modules/@tauri-apps/api/core.js"
          );
          await invoke("test_preview", {
            previewId,
            action: "open",
            url,
            bounds: { x: 0, y: 100, width: 600, height: 300 },
            visible: true,
          });
        },
        { previewId, url: `${url}/detached` },
      );
      await expect.poll(() => pages().some((page) => page.url() === `${url}/detached`)).toBe(true);
    } finally {
      await detached
        .evaluate(async (previewId) => {
          const { invoke } = await import(
            /* @vite-ignore */ "/node_modules/@tauri-apps/api/core.js"
          );
          await invoke("test_preview", { previewId, action: "close" });
          const { getCurrentWindow } = await import(
            /* @vite-ignore */ "/node_modules/@tauri-apps/api/window.js"
          );
          await getCurrentWindow().destroy();
        }, previewId)
        .catch(() => {});
    }
  } catch (error) {
    await app.screenshot({ path: "logs/e2e/browser-preview-native-error.png" }).catch(() => {});
    await writeFile(
      "logs/e2e/browser-preview-native-error.txt",
      JSON.stringify(
        {
          requests,
          pages: pages().map((page) => page.url()),
          text: await app
            .locator("body")
            .innerText()
            .catch(() => ""),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    const closes = app.getByRole("button", { name: "Close tab", exact: true });
    while (await closes.count()) await closes.last().click();
    await app
      .evaluate(async ({ id, previous }) => {
        const store = await import(/* @vite-ignore */ "/src/projects/api.ts");
        if (previous) store.switchProject(previous);
        store.removeProject(id);
      }, project)
      .catch(() => {});
    await browser.close();
    await new Promise<void>((resolve) => website.close(() => resolve()));
  }
});
