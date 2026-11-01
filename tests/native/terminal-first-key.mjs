// Requires a running native Cairngorm with WebView2 CDP enabled.
// NATIVE_CDP_URL=http://127.0.0.1:9222 node tests/native/terminal-first-key.mjs
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const browser = await chromium.connectOverCDP(
  process.env.NATIVE_CDP_URL ?? "http://127.0.0.1:9222",
);
try {
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => /localhost/.test(p.url()));
  assert.ok(page, "Native Cairngorm window not found");
  const result = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const sessionId = `first-key-qa-${Date.now()}`;
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const snapshot = async () => {
      const result = await invoke("pty_replay", { sessionId });
      return result ? atob(result.data) : "";
    };
    const waitFor = async (predicate) => {
      for (let i = 0; i < 100; i++) {
        const raw = await snapshot();
        if (predicate(raw)) return raw;
        await delay(50);
      }
      throw new Error("Timed out waiting for native terminal output");
    };
    try {
      await invoke("pty_ensure", {
        sessionId,
        shell: "powershell.exe",
        args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "function prompt { 'FIRST-KEY> ' }"],
        cwd: null,
        env: [],
        parseJsonl: false,
        killOnAgentEnd: false,
      });
      await waitFor((raw) => raw.includes("\x1b[6n"));
      // The same CPR + device-attributes replies xterm sends on first attach.
      await invoke("pty_write", { sessionId, data: "\x1b[1;1R\x1b[?62;4;9;22c" });
      const before = await waitFor((raw) => raw.includes("FIRST-KEY> "));
      await invoke("pty_write", { sessionId, data: "p" });
      await delay(500);
      await invoke("pty_write", { sessionId, data: "i" });
      const after = await waitFor((raw) => raw.length > before.length);
      await delay(200);
      const final = await snapshot();
      // Only examine echo after the prompt; startup/title bytes contain other p's.
      const echoed = final.slice(before.length).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
      return {
        echoed,
        hasQuery: before.includes("\x1b[6n"),
        outputReceived: after.length > before.length,
      };
    } finally {
      await invoke("pty_kill", { sessionId });
    }
  });
  assert.ok(result.hasQuery, "Regression did not exercise the startup cursor query");
  assert.match(result.echoed, /pi/, `First p was consumed; echo=${JSON.stringify(result.echoed)}`);
  console.log("PASS: startup cursor query answered once; first pi echoed intact");
} finally {
  await browser.close();
}
