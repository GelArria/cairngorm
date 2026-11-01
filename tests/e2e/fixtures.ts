import { test as base, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.resolve(__dirname, "../../logs/e2e");

import { SEED_INIT } from "../mocks/tauri-seed";
export { SEED_INIT };

type Fixtures = {
  app: import("@playwright/test").Page;
};

export const test = base.extend<Fixtures>({
  // Cold Vite compilation is setup work; test assertions retain their normal budget.
  app: [
    async ({ page }, use) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => {
        if (!localStorage.getItem("sidebar-side")) localStorage.setItem("sidebar-side", "left");
      });
      await page.addInitScript(SEED_INIT);
      await page.goto("/");
      await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 30000 });

      const screenshot = async (name: string) => {
        if (!fs.existsSync(SCREENSHOT_DIR)) {
          fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        }
        const file = path.join(SCREENSHOT_DIR, `${name}.png`);
        await page.screenshot({ path: file, fullPage: false });
        return file;
      };

      (page as any).takeScreenshot = screenshot;

      await use(page);
    },
    { timeout: 120000 },
  ],
});

export { expect };

type Page = import("@playwright/test").Page;

/** Launch explicitly: the application intentionally starts without an agent. */
export async function openAgentPane(app: Page) {
  await app.evaluate(() => {
    const api = (window as any).__TAURI_INTERNALS__,
      original = api.invoke;
    api.invoke = (cmd: string, args: unknown) =>
      cmd === "get_agent_env"
        ? Promise.resolve({
            apiKeyEnv: "OPENAI_API_KEY",
            keyAvailable: true,
            provider: "openai",
          })
        : original(cmd, args);
  });
  await app
    .getByRole("tablist", { name: "Workspace tabs" })
    .getByRole("button", { name: "New terminal", exact: true })
    .click();
  await app.getByRole("menuitem", { name: /Cairngorm agent/i }).click();
  await expect(app.locator("[data-pane-id]").first()).toBeVisible();
}

/** Flip the first agent pane through its real context menu. */
export async function setPaneView(app: Page, to: "Show Chat UI" | "Show TUI") {
  if ((await app.locator("[data-pane-id]").count()) === 0) await openAgentPane(app);
  await app
    .locator("[data-pane-id]")
    .first()
    .click({ button: "right", position: { x: 200, y: 200 } });
  await app.getByRole("menuitem", { name: to }).click();
}

/** Files open as panes in the terminal grid (there is no separate editor view any more).
 *  Waits for `readySelector` — the image viewer by default; pass e.g. ".cm-editor" for text. */
export async function openFileInGrid(
  app: Page,
  detail: Record<string, unknown>,
  readySelector = '[data-testid="image-viewer"]',
) {
  await app.locator('[data-testid="sidebar"]').waitFor();
  await app.evaluate(
    (d) => window.dispatchEvent(new CustomEvent("editor-open-file", { detail: d })),
    detail,
  );
  await app.locator(readySelector).first().waitFor({ state: "visible", timeout: 15000 });
}

declare module "@playwright/test" {
  interface Page {
    takeScreenshot: (name: string) => Promise<string>;
  }
}
