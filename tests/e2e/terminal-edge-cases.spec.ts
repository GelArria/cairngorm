import { test as base, expect, type Browser, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP = "http://127.0.0.1:9222";
const SHOTS = path.resolve(__dirname, "../../logs/e2e/edge-cases");
const LOGS = path.resolve(__dirname, "../../logs/e2e/edge-cases/logs");

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

// ── CDP connection ───────────────────────────────────────────────────────────

let _browser: Browser | null = null;
let _main: Page | null = null;
const logs: string[] = [];

async function browser(): Promise<Browser> {
  if (_browser) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.connectOverCDP(CDP);
  return _browser;
}

// ── Detached window helpers (via CDP HTTP endpoint) ─────────────────────────

interface Target {
  id: string;
  url: string;
  ws: string;
}

async function detachedTargets(): Promise<Target[]> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 3000);
  const resp = await fetch(`${CDP}/json/list`, { signal: ctrl.signal });
  clearTimeout(to);
  const all = await resp.json();
  return all
    .filter((t: any) => t.type === "page" && t.url.includes("detached="))
    .map((t: any) => ({ id: t.id, url: t.url, ws: t.webSocketDebuggerUrl }));
}

/** Find a detached Page in the main browser's contexts */
async function detachedPage(tabId?: string): Promise<Page | null> {
  const b = await browser();
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const ctx of b.contexts()) {
      for (const p of ctx.pages()) {
        const url = p.url();
        if (!url.includes("detached=")) continue;
        if (tabId && !url.includes(`detached=${tabId}`)) continue;
        return p;
      }
    }
    // If not found, try reconnecting the browser to discover new targets
    if (attempt === 3) {
      try {
        _browser?.close();
      } catch {}
      _browser = null;
      _main = null;
      await browser();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Close the detached browser connection after use */
async function releaseDetached(page: Page): Promise<void> {
  // No-op: page belongs to the main browser connection
}

// ── UI helpers ───────────────────────────────────────────────────────────────

async function getMain(): Promise<Page> {
  if (_main) return _main;
  const b = await browser();
  const pages = b.contexts()[0].pages();
  _main = pages.find((p) => p.url().includes("1420")) ?? pages[0];
  _main.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[terminal") || t.includes("[pty") || t.includes("agent")) logs.push(t);
  });
  return _main;
}

async function shot(page: Page, name: string, pass: number): Promise<void> {
  const file = path.join(SHOTS, `${pass === 1 ? "p1" : "p2"}-${name}.png`);
  let ctx = page.context();
  if (!ctx) {
    const b = await browser();
    ctx = b.contexts()[0];
  }
  const cdp = await ctx.newCDPSession(page);
  const res = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(res.data, "base64"));
  console.log(`[SHOT] ${file}`);
}

async function clickTitle(page: Page, title: string): Promise<void> {
  await page.locator(`button[title="${title}"]`).first().click();
}

async function switchMode(page: Page, mode: "tui" | "chat"): Promise<void> {
  await page
    .locator(`button[aria-label="${mode === "tui" ? "TUI" : "Chat UI"}"]`)
    .first()
    .click();
  await page.waitForTimeout(300);
}

async function typeTerm(page: Page, text: string): Promise<void> {
  await page.locator(".xterm").first().click();
  await page.waitForTimeout(100);
  await page.keyboard.type(text, { delay: 25 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
}

/** Click detach button and poll for the new detached target */
async function doDetach(page: Page): Promise<Target | undefined> {
  const pre = await detachedTargets();
  await clickTitle(page, "Detach terminal to window");
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500);
    const post = await detachedTargets();
    const det = post.find((t) => !pre.some((p2) => p2.id === t.id));
    if (det) return det;
  }
  return undefined;
}

async function waitAgent(page: Page, maxMs: number = 12000): Promise<void> {
  const deadline = Date.now() + maxMs;
  // Wait for "running" badge
  while (Date.now() < deadline) {
    const badge = page
      .locator("span")
      .filter({ hasText: /^running$/ })
      .first();
    if ((await badge.count()) > 0) break;
    await page.waitForTimeout(200);
  }
  // Wait for "ended" badge
  while (Date.now() < deadline) {
    const badge = page
      .locator("span")
      .filter({ hasText: /^ended$/ })
      .first();
    if ((await badge.count()) > 0) {
      await page.waitForTimeout(800); // settle for DOM render
      return;
    }
    await page.waitForTimeout(500);
  }
}

/** Reattach by pressing Ctrl+Shift+A inside the detached window */
async function reattach(mainPage: Page, tabId: string): Promise<void> {
  const detPage = await detachedPage(tabId);
  if (!detPage) {
    console.log(`[WARN] No detached page found for tab ${tabId}`);
    return;
  }
  // Method 1: Click the Reattach button by title attribute
  const btn = detPage.locator('button[title*="Reattach"]').first();
  if ((await btn.count()) > 0) {
    console.log(`[REAT] Clicking Reattach button for tab ${tabId}`);
    await btn.click();
  } else {
    // Method 2: Ctrl+Shift+A keyboard shortcut
    console.log(`[REAT] Using Ctrl+Shift+A for tab ${tabId}`);
    await detPage.focus("body");
    await detPage.keyboard.press("Control+Shift+A");
  }
  await releaseDetached(detPage);
  await mainPage.waitForTimeout(1500);
}

async function reattachAll(mainPage: Page): Promise<void> {
  const targets = await detachedTargets();
  for (const t of targets) {
    const url = new URL(t.url);
    const id = url.searchParams.get("detached");
    if (id) await reattach(mainPage, id);
  }
}

async function domState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    xterm: document.querySelectorAll(".xterm").length,
    detached: document.body.innerText.match(/(\d+)\s+detached/)?.[1] ?? "0",
    badges: Array.from(document.querySelectorAll("button[title]")).map((b) => b.title),
    grid: !!document.querySelector('[style*="gridTemplateColumns"]'),
    text: document.body.innerText.slice(0, 300),
  }));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const test = base.extend<{ main: Page }>({
  main: async ({}, use) => {
    // These specs drive the REAL desktop app over CDP — skip cleanly when it's not running
    test.skip(
      process.env.E2E_REAL !== "1",
      "requires real Tauri app with --remote-debugging-port=9222 (run with E2E_REAL=1)",
    );
    const page = await getMain();
    // Dismiss crash overlay
    const overlay = page.locator(".fixed.inset-0.z-\\[100\\]");
    if ((await overlay.count()) > 0) {
      await overlay.evaluate((el) => el.remove());
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(500);
    await use(page);
  },
});

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.describe("Terminal edge cases - full lifecycle", () => {
  test.afterAll(async () => {
    fs.writeFileSync(path.join(LOGS, "console-logs.txt"), logs.join("\n"));
  });

  test("Pasada 1 - Flujo completo", async ({ main: page }) => {
    const p = 1;
    const W = 12000; // agent wait

    // 1. Init
    console.log("[P1] 1. Init");
    await page.waitForTimeout(2000);
    await reattachAll(page);
    await page.waitForTimeout(500);
    await shot(page, "01-init", p);

    // 2. Prompt in TUI
    console.log("[P1] 2. Prompt in TUI");
    await typeTerm(page, "say hi");
    await shot(page, "02-prompt", p);
    await waitAgent(page, W);
    await shot(page, "03-response", p);

    // 3. Detach
    console.log("[P1] 3. Detach");
    const det = await doDetach(page);
    if (!det) console.log("[P1] WARN: No detached target found after 8s");
    await shot(page, "04-main-detached", p);

    // 4. Prompt in detached window
    console.log("[P1] 4. Prompt in detached");
    const detPage = await detachedPage();
    if (detPage) {
      await shot(detPage, "05-det-init", p);
      await typeTerm(detPage, "say hello");
      await shot(detPage, "05-det-typed", p);
      await waitAgent(detPage, W);
      await shot(detPage, "06-det-response", p);
    } else {
      console.log("[P1] WARN: No detached page found for interaction");
    }

    // 5. Reattach
    console.log("[P1] 5. Reattach");
    const tabId = det ? new URL(det.url).searchParams.get("detached") : null;
    if (tabId) {
      await reattach(page, tabId);
    } else {
      console.log("[P1] WARN: Skipping reattach - no detached tab");
    }
    await shot(page, "07-reattached", p);

    // 6. Prompt after reattach
    console.log("[P1] 6. Prompt after reattach");
    await typeTerm(page, "what can you do?");
    await shot(page, "08-prompt-2", p);
    await waitAgent(page, W);
    await shot(page, "09-response-2", p);

    // 7. Split terminal
    console.log("[P1] 7. Split");
    await clickTitle(page, "Split terminal");
    await page.waitForTimeout(1500);
    await shot(page, "10-split", p);
    const grid = page.locator('[style*="gridTemplateColumns"]').first();
    const gridCount = await grid.count();
    console.log(`[P1] Grid count: ${gridCount}`);
    if (gridCount > 0) {
      const children = await grid.locator("> div").count();
      console.log(`[P1] Split children: ${children}`);
    }

    // 8. Prompt in second split panel
    console.log("[P1] 8. Prompt in split");
    const terms = page.locator(".xterm");
    if ((await terms.count()) > 1) await terms.nth(1).click();
    await typeTerm(page, "count to 3");
    await shot(page, "11-split-prompt", p);
    await waitAgent(page, W);
    await shot(page, "12-split-response", p);

    // 9. Detach from split (should dissolve split)
    console.log("[P1] 9. Detach from split");
    const det2 = await doDetach(page);
    if (!det2) console.log("[P1] WARN: No split-detached target found");
    await shot(page, "13-split-detached-main", p);

    // 10. Screenshot the detached-from-split window
    console.log("[P1] 10. Detached from split window");
    const detPage2 = det2
      ? await detachedPage(new URL(det2.url).searchParams.get("detached")!)
      : null;
    if (detPage2) {
      await shot(detPage2, "14-det-from-split", p);
      // Type in the detached-from-split terminal
      await typeTerm(detPage2, "are you still working?");
      await shot(detPage2, "14-det-split-typed", p);
      await waitAgent(detPage2, W);
      await shot(detPage2, "15-det-split-response", p);
      await releaseDetached(detPage2);
    }

    // 11. Check main state after split detach
    console.log("[P1] 11. Main state after split detach");
    const state = await domState(page);
    console.log("[P1] Main state:", JSON.stringify(state));
    // Split should be dissolved, only 1 inline terminal or empty
    await shot(page, "16-main-after-split-detach", p);

    // 12. Reattach from split detach
    console.log("[P1] 12. Reattach from split");
    const tabId2 = det2 ? new URL(det2.url).searchParams.get("detached") : null;
    if (tabId2) {
      await reattach(page, tabId2);
    } else {
      console.log("[P1] WARN: Skipping reattach from split - no detached tab");
    }
    await shot(page, "17-reattached-from-split", p);

    // 13. Split again after reattach
    console.log("[P1] 13. Split again");
    await clickTitle(page, "Split terminal");
    await page.waitForTimeout(1500);
    await shot(page, "18-split-2", p);

    // 14. Detach again from split
    console.log("[P1] 14. Detach from split 2");
    const det3 = await doDetach(page);
    if (det3) {
      await shot(page, "19-split2-detach-main", p);
      const dp3 = await detachedPage(new URL(det3.url).searchParams.get("detached")!);
      if (dp3) {
        await shot(dp3, "19-split2-det-window", p);
        await releaseDetached(dp3);
      }
    }

    // 15. Check mirroring Chat UI
    console.log("[P1] 15. Mirroring check");
    await reattachAll(page);
    await page.waitForTimeout(500);
    await switchMode(page, "chat");
    await page.waitForTimeout(500);
    await shot(page, "20-chat-mirroring", p);
    const chatMsgs = await page.locator("p.whitespace-pre-wrap").count();
    console.log(`[P1] Chat messages: ${chatMsgs}`);

    // 16. Prompt via Chat UI
    console.log("[P1] 16. Chat UI prompt");
    const textarea = page.locator('textarea[placeholder="Type a message…"]').first();
    await textarea.click();
    await textarea.fill("explain yourself");
    await textarea.press("Enter");
    await shot(page, "21-chat-typed", p);
    await waitAgent(page, W);
    await shot(page, "22-chat-response", p);

    // 17. Back to TUI, unsplit
    console.log("[P1] 17. Back to TUI");
    await switchMode(page, "tui");
    await page.waitForTimeout(300);
    await shot(page, "23-back-tui", p);

    // 18. Unsplit
    console.log("[P1] 18. Unsplit");
    const unsplitBtn = page.locator('button[title="Unsplit terminals"]').first();
    if ((await unsplitBtn.count()) > 0) {
      await unsplitBtn.click();
      await page.waitForTimeout(500);
    }
    await shot(page, "24-unsplit", p);

    // 19. Rapid detach/attach x3
    console.log("[P1] 19. Rapid detach/attach x3");
    for (let i = 0; i < 3; i++) {
      const detR = await doDetach(page);
      if (detR) {
        const dp = await detachedPage();
        if (dp) {
          await shot(dp, `25-rapid-${i}`, p);
        } else {
          await shot(page, `25-rapid-${i}-main`, p);
        }
        const tid = new URL(detR.url).searchParams.get("detached");
        if (tid) await reattach(page, tid);
        await page.waitForTimeout(300);
      }
    }
    await shot(page, "26-rapid-done", p);

    // 20. Final state
    console.log("[P1] 20. Final state");
    await page.waitForTimeout(1000);
    const finalState = await domState(page);
    console.log("[P1] Final:", JSON.stringify(finalState));
    await shot(page, "27-final", p);
  });

  test("Pasada 2 - Flujo rapido", async ({ main: page }) => {
    const p = 2;
    const W = 8000;

    console.log("[P2] Start");
    // Open a terminal if none exists
    if ((await page.locator(".xterm").count()) === 0) {
      await page.locator('button:has-text("+")').click();
      await page.waitForTimeout(3000);
    }
    await switchMode(page, "tui");
    await page.waitForTimeout(300);
    await shot(page, "00-start", p);

    // 1. Prompt
    console.log("[P2] 1. Prompt");
    await typeTerm(page, "say hi");
    await shot(page, "01-prompt", p);
    await waitAgent(page, W);
    await shot(page, "02-response", p);

    // 2. Detach + prompt in detached + reattach
    console.log("[P2] 2. Detach");
    const det = await doDetach(page);
    if (det) {
      const dp = await detachedPage();
      if (dp) {
        await shot(dp, "03-det", p);
        await typeTerm(dp, "say hello");
        await shot(dp, "03-det-typed", p);
        await waitAgent(dp, W);
        await shot(dp, "04-det-response", p);
      }
      const tid = new URL(det.url).searchParams.get("detached");
      if (tid) await reattach(page, tid);
    }
    await shot(page, "05-reattached", p);

    // 3. Split + prompt
    console.log("[P2] 3. Split");
    await clickTitle(page, "Split terminal");
    await page.waitForTimeout(800);
    await shot(page, "06-split", p);
    const terms = page.locator(".xterm");
    if ((await terms.count()) > 1) await terms.nth(1).click();
    await typeTerm(page, "count to 3");
    await shot(page, "07-split-prompt", p);
    await waitAgent(page, W);
    await shot(page, "08-split-response", p);

    // 4. Detach from split
    console.log("[P2] 4. Detach from split");
    const det2 = await doDetach(page);
    if (det2) {
      await shot(page, "09-split-det-main", p);
      const dp2 = await detachedPage(new URL(det2.url).searchParams.get("detached")!);
      if (dp2) {
        await shot(dp2, "09-split-det-win", p);
        await typeTerm(dp2, "still here?");
        await shot(dp2, "10-det-typed", p);
        await waitAgent(dp2, W);
        await shot(dp2, "10-det-response", p);
      }
    }

    // 5. Reattach + mirroring check
    console.log("[P2] 5. Reattach + mirroring");
    await reattachAll(page);
    await page.waitForTimeout(300);
    await switchMode(page, "chat");
    await page.waitForTimeout(300);
    await shot(page, "11-mirror", p);

    // 6. Chat UI prompt
    console.log("[P2] 6. Chat UI");
    const ta = page.locator('textarea[placeholder="Type a message…"]').first();
    await ta.click();
    await ta.fill("explain yourself");
    await ta.press("Enter");
    await waitAgent(page, W);
    await shot(page, "12-chat-resp", p);

    // 7. Back to TUI + unsplit
    console.log("[P2] 7. Back to TUI");
    await switchMode(page, "tui");
    await page.waitForTimeout(200);
    const us = page.locator('button[title="Unsplit terminals"]').first();
    if ((await us.count()) > 0) await us.click();
    await page.waitForTimeout(300);
    await shot(page, "13-unsplit", p);

    // 8. Rapid detach/attach x5
    console.log("[P2] 8. Rapid x5");
    for (let i = 0; i < 5; i++) {
      const detR = await doDetach(page);
      if (detR) {
        if (i % 2 === 0) {
          const dp = await detachedPage();
          if (dp) {
            await shot(dp, `14-rapid-${i}`, p);
          }
        }
        const tid = new URL(detR.url).searchParams.get("detached");
        if (tid) await reattach(page, tid);
        await page.waitForTimeout(200);
      }
    }
    await shot(page, "15-rapid-done", p);

    // 9. Final
    console.log("[P2] 9. Final");
    await page.waitForTimeout(500);
    await shot(page, "16-final", p);
    const fs2 = await domState(page);
    console.log("[P2] Final:", JSON.stringify(fs2));
  });
});
