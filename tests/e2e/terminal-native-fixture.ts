import { test as base, expect, chromium, type Page } from "@playwright/test";
import path from "path";
import fs from "node:fs";

const installedPiTui =
  process.env.PI_TUI_TEST_MODULE ??
  path.join(
    process.env.APPDATA ?? "",
    "npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.js",
  );
export const piTuiModule = fs.existsSync(installedPiTui) ? installedPiTui : null;

export async function terminalText(page: Page, nth = 0): Promise<string> {
  return page
    .locator(".xterm")
    .nth(nth)
    .evaluate((el) => {
      const rows = el.querySelectorAll(".xterm-rows > div");
      return [...rows].map((r) => r.textContent).join("\n");
    });
}

export async function inputBytes(page: Page, nth = 0): Promise<string> {
  return (
    (await terminalText(page, nth))
      .match(/KEY:[0-9a-f]+/g)
      ?.map((s) => s.slice(4))
      .join("") ?? ""
  );
}

export async function startProbe(page: Page, nth = 0) {
  await expect
    .poll(async () => (await terminalText(page, nth)).replace(/\n/g, ""), { timeout: 15000 })
    .toContain("terminal-parity-workspace");
  const term = page.locator(".xterm").nth(nth);
  await term.click();
  await expect(term.locator(".xterm-helper-textarea")).toBeFocused();
  const piArg = piTuiModule ? ` "${piTuiModule.replace(/\\/g, "/")}"` : "";
  await page.keyboard.type(
    `node "${path.resolve("tests/e2e/fixtures/terminal-input-probe.cjs").replace(/\\/g, "/")}"${piArg}`,
    { delay: 2 },
  );
  await page.keyboard.press("Enter");
  await expect.poll(() => terminalText(page, nth), { timeout: 15000 }).toContain("PROBE-READY");
}

export const test = base.extend<{ native: Page }>({
  native: async ({}, use) => {
    base.skip(
      base.info().config.metadata.nativeTerminal !== true,
      "Use tests/playwright.terminal.config.ts with an isolated native dev app",
    );
    const browser = await chromium.connectOverCDP(
      process.env.NATIVE_CDP_URL ?? "http://127.0.0.1:9222",
    );
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => p.url() === "http://localhost:1420/")!;
    if (!page) {
      await browser.close();
      throw new Error("Native Cairngorm dev window not found at http://localhost:1420/");
    }
    const project = await page.evaluate(async (root) => {
      const url = "/src/projects/api.ts";
      const s = await import(/* @vite-ignore */ url);
      const previous = s.getProjectsState().activeId;
      const p = s.createProject(root, "Terminal parity QA");
      return { id: p.id, previous };
    }, path.resolve("logs/terminal-parity-workspace"));
    let clipboard: string | undefined;
    try {
      await browser.contexts()[0].grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.bringToFront();
      clipboard = await page.evaluate(() => navigator.clipboard.readText());
      await page
        .getByRole("tablist", { name: "Workspace tabs" })
        .getByRole("button", { name: "New terminal", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: /^PowerShell/ })
        .first()
        .click();
      await startProbe(page);
      await use(page);
    } finally {
      await page.keyboard.up("Alt").catch(() => {});
      await page.keyboard.up("Control").catch(() => {});
      await page.keyboard.up("Shift").catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      const closes = page.getByRole("button", { name: "Close tab", exact: true });
      while (await closes.count()) await closes.last().click();
      if (clipboard !== undefined)
        await page.evaluate((t) => navigator.clipboard.writeText(t), clipboard).catch(() => {});
      await page.evaluate(async ({ id, previous }) => {
        const url = "/src/projects/api.ts";
        const s = await import(/* @vite-ignore */ url);
        if (previous) s.switchProject(previous);
        s.removeProject(id);
      }, project);
      await browser.close();
    }
  },
});

export { expect };
