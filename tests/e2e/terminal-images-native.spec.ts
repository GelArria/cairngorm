import { test, expect, chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

// Real PowerShell → ConPTY → Tauri → TerminalTab. Isolated overlays leave
// the user's existing terminals mounted; only test PTYs are disposed.
// Requires native CDP on 9222 and unmocked Vite on 1420.
for (const mode of ["powershell", "pi-imgcat"]) {
  test(`${mode} renders real Sixel pixels in Cairngorm`, async () => {
    test.skip(
      test.info().config.metadata.nativeImages !== true,
      "Use tests/playwright.images-native.config.ts with native Cairngorm running",
    );
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => /http:\/\/(?:localhost:1420|tauri.localhost)\//.test(p.url()));
    if (!page) {
      await browser.close();
      throw new Error("Native Cairngorm window not found");
    }
    const cwd = path.resolve("logs/image-probe-workspace");
    fs.mkdirSync(cwd, { recursive: true });
    const source = path.resolve("tests/e2e/fixtures/imgcat.png");
    const extension = path.join(
      process.env.USERPROFILE!,
      ".pi/agent/extensions/pi-imgcat/index.ts",
    );
    const guard = path.resolve("tests/e2e/fixtures/pi-image-qa.ts");
    const command =
      mode === "powershell"
        ? `& "$HOME/bin/timg/timg.exe" -ps --frames=1 --loops=1 -E -g40x25 '${source}'; Start-Sleep -Seconds 60`
        : `pi -ne -e '${extension}' -e '${guard}' --no-tools --no-skills --no-prompt-templates --no-context-files --no-session`;
    const sessionId = `sixel-qa-${Date.now()}`;
    try {
      await page.evaluate(
        async ({ sessionId, cwd, command }) => {
          const preactUrl = "http://localhost:1420/node_modules/.vite/deps/preact.js";
          const terminalUrl = "http://localhost:1420/src/terminal/components/terminal-tab.tsx";
          const { h, render } = await import(/* @vite-ignore */ preactUrl);
          const { TerminalTab } = await import(/* @vite-ignore */ terminalUrl);
          const host = document.createElement("div");
          host.id = "native-image-probe";
          host.className = "dark";
          host.style.cssText =
            "position:fixed;inset:45px 10px 10px 10px;z-index:999;background:#0c0c0c";
          document.body.appendChild(host);
          const opener = document.activeElement as HTMLElement | null;
          (window as any).__imageProbeCleanup = () => {
            render(null, host);
            host.remove();
            opener?.focus();
            localStorage.removeItem(`panel-scrollback:${sessionId}`);
          };
          render(
            h(TerminalTab, {
              sessionId,
              cwd,
              shellPath: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
              shellArgs: ["-NoLogo", "-NoProfile", "-Command", command],
            }),
            host,
          );
        },
        { sessionId, cwd, command },
      );
      const term = page.locator("#native-image-probe .xterm");
      if (mode === "pi-imgcat") {
        // /img is manual: no LLM request and no provider cost.
        await expect(term.locator(".xterm-rows")).toContainText("imgcat mode: sixel (Cairngorm)", {
          timeout: 20000,
        });
        await term.click();
        await expect(term.locator(".xterm-helper-textarea")).toBeFocused();
        await page.keyboard.press("Control+u");
        await page.keyboard.type(`/img ${source}`, { delay: 3 });
        await page.keyboard.press("Enter");
        await expect(term.locator(".xterm-rows")).toContainText("imgcat:", { timeout: 20000 });
        await expect(term.locator(".xterm-rows")).not.toContainText("Ollama Cloud");
      }
      await expect
        .poll(
          () =>
            term.evaluate((el) => {
              const canvas = el.querySelector<HTMLCanvasElement>("canvas.xterm-image-layer");
              const ctx = canvas?.getContext("2d");
              if (!ctx || !canvas) return 0;
              const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              let count = 0;
              for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 200) count++;
              return count;
            }),
          { timeout: 20000 },
        )
        .toBeGreaterThan(10000);
      await page.screenshot({ path: `logs/e2e/terminal-sixel-native-${mode}.png` });
    } catch (error) {
      await page.screenshot({ path: `logs/e2e/terminal-sixel-native-${mode}-failure.png` });
      const replay = await page.evaluate(
        (sessionId) => (window as any).__TAURI_INTERNALS__.invoke("pty_replay", { sessionId }),
        sessionId,
      );
      fs.writeFileSync(
        `logs/terminal-image-native-${mode}-replay.bin`,
        Buffer.from(replay ?? "", "base64"),
      );
      throw error;
    } finally {
      await page.evaluate(async (sessionId) => {
        (window as any).__imageProbeCleanup?.();
        delete (window as any).__imageProbeCleanup;
        await (window as any).__TAURI_INTERNALS__.invoke("pty_kill", { sessionId });
      }, sessionId);
      await browser.close();
    }
  });
}
