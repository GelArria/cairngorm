import { test, expect, chromium, type Page } from "@playwright/test";
import path from "node:path";
import { piTuiModule } from "./terminal-native-fixture";

async function mountProbe(page: Page, sessionId: string, args: string[]) {
  await page.evaluate(
    async ({ sessionId, args }) => {
      const { h, render } = await import(
        /* @vite-ignore */ "http://localhost:1420/node_modules/.vite/deps/preact.js"
      );
      const { TerminalTab } = await import(
        /* @vite-ignore */ "http://localhost:1420/src/terminal/components/terminal-tab.tsx"
      );
      const host = document.createElement("div");
      host.id = "native-mouse-probe";
      host.style.cssText = "position:fixed;inset:45px 10px 10px;z-index:999;background:#0c0c0c";
      document.body.appendChild(host);
      const opener = document.activeElement as HTMLElement | null;
      const mount = () =>
        render(h(TerminalTab, { sessionId, shellPath: "node.exe", shellArgs: args }), host);
      (window as any).__mouseReplayRemount = () => {
        render(null, host);
        mount();
      };
      (window as any).__mouseReplayCleanup = () => {
        render(null, host);
        host.remove();
        opener?.focus();
        localStorage.removeItem(`panel-scrollback:${sessionId}`);
      };
      mount();
    },
    { sessionId, args },
  );
}

async function cleanupProbe(page: Page, sessionId: string) {
  await page.evaluate(async (sessionId) => {
    (window as any).__mouseReplayCleanup?.();
    delete (window as any).__mouseReplayCleanup;
    delete (window as any).__mouseReplayRemount;
    await (window as any).__TAURI_INTERNALS__.invoke("pty_kill", { sessionId });
  }, sessionId);
}

// Real Pi → ConPTY → xterm. An isolated overlay keeps user PTYs mounted.
test("Pi clicks survive remount after its startup modes leave the replay ring", async () => {
  test.skip(
    test.info().config.metadata.nativeMouseReplay !== true,
    "Use tests/playwright.mouse-native.config.ts",
  );
  test.skip(!piTuiModule, "Installed Pi TUI required");
  const browser = await chromium.connectOverCDP(
    process.env.NATIVE_CDP_URL ?? "http://127.0.0.1:9222",
  );
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => /http:\/\/(?:localhost:1420|tauri.localhost)\//.test(p.url()));
  if (!page) {
    await browser.close();
    throw new Error("Native Cairngorm window not found");
  }
  const sessionId = `mouse-replay-qa-${Date.now()}`;
  const args = [
    path.resolve("tests/e2e/fixtures/pi-mouse-probe.mjs"),
    piTuiModule!,
    "--overflow-replay",
  ];
  try {
    await mountProbe(page, sessionId, args);
    const button = page
      .locator("#native-mouse-probe .xterm-rows > div")
      .filter({ hasText: "Jump to latest message" });
    await expect(button).toBeVisible({ timeout: 15000 });
    // Ensure the startup mouse sequences were really evicted, not just simulated.
    await expect
      .poll(() =>
        page.evaluate(async (sessionId) => {
          const replay = await (window as any).__TAURI_INTERNALS__.invoke("pty_replay", {
            sessionId,
          });
          return atob(replay ?? "").length;
        }, sessionId),
      )
      .toBeGreaterThanOrEqual(256 * 1024);
    await page.evaluate(() => (window as any).__mouseReplayRemount());
    await expect(button).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: "logs/e2e/terminal-mouse-replay-before-click.png" });
    const bounds = (await button.boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(button).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator("#native-mouse-probe .xterm-rows")).toContainText(
      "PI-TRANSCRIPT 199",
    );
    await page.screenshot({ path: "logs/e2e/terminal-mouse-replay-after-click.png" });
  } finally {
    await cleanupProbe(page, sessionId);
    await browser.close();
  }
});

for (const [name, sequence] of [
  ["escape ending OSC", "\x1b[?1003h\x1b]0;title\x1b[?1003l\x07"],
  ["escape ending DCS", "\x1b[?1003h\x1bPqimage\x1b[?1003l"],
  ["parameterized DECSTR", "\x1b[?1;66;1004;2004h\x1b[0!p"],
  ["C0 inside CSI", "\x1b[?1003h\x1b[?1003\nl"],
]) {
  test(`${name}: replay preserves actual xterm's reset input modes`, async () => {
    test.skip(
      test.info().config.metadata.nativeMouseReplay !== true,
      "Use tests/playwright.mouse-native.config.ts",
    );
    const browser = await chromium.connectOverCDP(
      process.env.NATIVE_CDP_URL ?? "http://127.0.0.1:9222",
    );
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => /http:\/\/(?:localhost:1420|tauri.localhost)\//.test(p.url()));
    if (!page) {
      await browser.close();
      throw new Error("Native Cairngorm window not found");
    }
    const sessionId = `input-reset-qa-${Date.now()}`;
    // Construct the filler inside the child, not its argv (Windows length limit).
    const args = [
      "-e",
      `process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write(${JSON.stringify(sequence)}+"\\x1b[0m".repeat(70000)+"\\r\\nMODES-READY\\r\\n");`,
    ];
    const modes = () =>
      page.evaluate(async (sessionId) => {
        const { getTerm } = await import(
          /* @vite-ignore */ "http://localhost:1420/src/terminal/runtime/term-registry.ts"
        );
        return getTerm(sessionId)?.modes;
      }, sessionId);
    try {
      await mountProbe(page, sessionId, args);
      const rows = page.locator("#native-mouse-probe .xterm-rows");
      await expect(rows).toContainText("MODES-READY", { timeout: 15000 });
      const live = await modes();
      expect(live).toMatchObject({
        mouseTrackingMode: "none",
        applicationCursorKeysMode: false,
        applicationKeypadMode: false,
        bracketedPasteMode: false,
      });
      // Node/ConPTY can enable focus reporting during raw-mode initialization.
      if (name === "parameterized DECSTR") expect(live?.sendFocusMode).toBe(false);
      await page.evaluate(() => (window as any).__mouseReplayRemount());
      await expect(rows).toContainText("MODES-READY", { timeout: 15000 });
      expect(await modes()).toEqual(live);
    } finally {
      await cleanupProbe(page, sessionId);
      await browser.close();
    }
  });
}
