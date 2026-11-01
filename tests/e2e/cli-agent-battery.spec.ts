import { test as base, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP = "http://127.0.0.1:9222";
const SHOTS = path.resolve(__dirname, "../../logs/e2e/cli-battery");
fs.mkdirSync(SHOTS, { recursive: true });

// Robustness battery of the agent CLI (gemma4) against the REAL app:
// detach → split → views → close/open → detach → triple-split → attach → persistence.
// Verifies in each window DOM (xterm rows), not just logs. Screenshot at each step.

interface Target {
  id: string;
  url: string;
}
let _browser: import("@playwright/test").Browser | null = null;
const fails: string[] = [];
const notes: string[] = [];

async function browser() {
  if (_browser) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.connectOverCDP(CDP);
  return _browser;
}
async function mainPage() {
  const b = await browser();
  return (
    b
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("1420")) ?? b.contexts()[0].pages()[0]
  );
}
async function detachedTargets(): Promise<Target[]> {
  const all = await (await fetch(`${CDP}/json/list`)).json();
  return all.filter((t: any) => t.type === "page" && t.url.includes("detached="));
}
async function detachedPage(tabId?: string) {
  const b = await browser();
  for (let i = 0; i < 10; i++) {
    for (const p of b.contexts()[0].pages()) {
      if (!p.url().includes("detached=")) continue;
      if (tabId && !p.url().includes(`detached=${tabId}`)) continue;
      return p;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
async function shot(page: import("@playwright/test").Page, name: string) {
  const cdp = await page.context().newCDPSession(page);
  const res = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(res.data, "base64"));
  await cdp.detach();
  console.log(`[SHOT] ${name}`);
}
/** Visible xterm text (real DOM rows, without injected CSS). */
async function xtermText(page: import("@playwright/test").Page, nth = 0): Promise<string> {
  return page.evaluate((i) => {
    const x = [...document.querySelectorAll(".xterm")][i];
    if (!x) return "";
    return [...x.querySelectorAll(".xterm-rows > div")].map((d) => d.textContent ?? "").join("\n");
  }, nth);
}
async function allXtermText(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    return [...document.querySelectorAll(".xterm")].map((x) =>
      [...x.querySelectorAll(".xterm-rows > div")].map((d) => d.textContent ?? "").join("\n"),
    );
  });
}
async function typePrompt(page: import("@playwright/test").Page, nth: number, text: string) {
  const xterm = page.locator(".xterm").nth(nth);
  await xterm.click();
  await page.waitForTimeout(150);
  await page.keyboard.type(text, { delay: 8 });
  await page.keyboard.press("Enter");
}
/** Waits until the needle appears in xterm N (DOM verification). */
async function waitReply(
  page: import("@playwright/test").Page,
  nth: number,
  needle: string,
  maxMs = 60_000,
) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const txt = (await allXtermText(page))[nth] ?? "";
    if (txt.toLowerCase().includes(needle.toLowerCase())) return true;
    await page.waitForTimeout(800);
  }
  return false;
}
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`[STEP OK] ${name}`);
  } catch (e) {
    fails.push(
      `${name}: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`,
    );
    console.log(`[STEP FAIL] ${name} — ${fails[fails.length - 1]}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const test = base.extend({});
test.setTimeout(900_000);
test.skip(process.env.E2E_REAL !== "1", "requires the real app with CDP 9222 (E2E_REAL=1)");

test("agent CLI battery gemma4: detach/split/close/attach/persistence", async () => {
  const main = await mainPage();

  await step("S0 — app alive, agent mounted, no crash overlay", async () => {
    await main.waitForTimeout(2000);
    assert((await main.locator(".xterm").count()) >= 1, "no xterm mounted");
    assert(!(await main.locator('div[class*="z-[100]"]').count()), "crash overlay present");
    await shot(main, "00-inicial");
  });

  await step("S1 — CLI: prompt gemma with the secret code", async () => {
    await typePrompt(main, 0, "Remember this code: GEMMA-ALPHA-77. Answer only: ACK-ALPHA");
    const ok = await waitReply(main, 0, "ACK-ALPHA");
    assert(ok, "gemma did not answer ACK-ALPHA in the xterm");
    await shot(main, "01-gemma-first-answer");
  });

  await step("S2 — detach and gemma in the detached window (context persistence)", async () => {
    await main.locator('button[title*="Detach"]').first().click();
    const det = await detachedPage();
    assert(det, "detached window did not appear");
    await det.waitForTimeout(1500);
    assert((await det.locator(".xterm").count()) >= 1, "xterm not mounted in the detached window");
    await typePrompt(det, 0, "What code did I give you before? Answer with the code only.");
    const ok = await waitReply(det, 0, "GEMMA-ALPHA-77");
    assert(ok, "gemma did NOT remember GEMMA-ALPHA-77 after detach: context does not persist");
    await shot(det, "02-detach-gemma-remembers");
    notes.push("context survives detach");
  });

  await step("S3 — split the inline + gemma in the new terminal", async () => {
    // the only tab is detached: open a new inline one
    await main.locator('button[aria-label="New terminal"]').click();
    await main.waitForTimeout(2500);
    await main.locator('button[aria-label^="Split"]').first().click();
    await main.waitForTimeout(1000);
    const n = await main.locator(".xterm").count();
    assert(n >= 2, `split did not produce 2 panes (xterm=${n})`);
    await typePrompt(main, 1, "Answer only: ACK-SPLIT-PANE");
    const ok = await waitReply(main, 1, "ACK-SPLIT-PANE");
    assert(ok, "pane 2 (new split) did not respond");
    await shot(main, "03-split-gemma-pane2");
  });

  await step("S4 — touch the platform UI (all views) and come back", async () => {
    await main.locator('[data-testid="mode-calendar"]').first().click({ timeout: 5000 });
    await main.waitForTimeout(600);
    await main.locator('[data-testid="mode-calendar"]').first().click(); // toggle back to the grid
    assert(
      !(await main.locator('div[class*="z-[100]"]').count()),
      "crash overlay after the view tour",
    );
    await main.waitForTimeout(1500);
    const n = await main.locator(".xterm").count();
    assert(n >= 2, `panes did not survive the view tour (xterm=${n})`);
    const txts = await allXtermText(main);
    assert(txts[1]?.includes("ACK-SPLIT-PANE"), "pane 2 conversation was lost after the view tour");
    await shot(main, "04-tras-tour-vistas");
  });

  await step("S5 — close EVERYTHING, new terminal, gemma (fresh session = isolation)", async () => {
    const before = (await detachedTargets()).length;
    let guard = 0;
    while (guard++ < 8) {
      const btn = main.locator('button[title*="Close"], button:text("×")').first();
      if (!(await btn.count())) break;
      await btn.click().catch(() => {});
      await main.waitForTimeout(400);
    }
    await main.waitForTimeout(500);
    assert((await main.locator(".xterm").count()) === 0, "not all inline tabs were closed");
    await main.locator('button[aria-label="New terminal"]').click();
    await main.waitForTimeout(2500);
    assert((await main.locator(".xterm").count()) === 1, "new terminal did not mount 1 xterm");
    await typePrompt(
      main,
      0,
      "What secret code did I give you before? If you do not know, answer: DONT-KNOW",
    );
    const ok = await waitReply(main, 0, "DONT-KNOW");
    assert(
      ok,
      "the new session did not answer DONT-KNOW — (or it leaks context from the dead session!)",
    );
    notes.push(
      `new session does NOT inherit the previous conversation (isolation OK), detaches=${before}`,
    );
    await shot(main, "05-sesion-fresca");
  });

  await step("S6 — detach + triple split on the detached CLI + gemma in all 3", async () => {
    await main.locator('button[title*="Detach"]').first().click();
    const det = await detachedPage();
    assert(det, "the second detached window did not appear");
    await det.waitForTimeout(1500);
    // triple split: split twice → 3 panes
    await det.locator('button[aria-label^="Split"]').first().click();
    await det.waitForTimeout(800);
    await det.locator('button[aria-label^="Split"]').first().click();
    await det.waitForTimeout(800);
    const n = await det.locator(".xterm").count();
    assert(n === 3, `triple split expected 3 panes, got ${n}`);
    // gemma in all 3, each with its marker
    for (let i = 0; i < 3; i++) {
      await typePrompt(det, i, `Answer only: ACK-PANE-${i + 1}`);
      await det.waitForTimeout(300);
    }
    for (let i = 0; i < 3; i++) {
      const ok = await waitReply(det, i, `ACK-PANE-${i + 1}`, 90_000);
      assert(ok, `pane ${i + 1} did not answer ACK-PANE-${i + 1}`);
    }
    await shot(det, "06-triple-split-gemma-3panes");
  });

  await step("S7 — attach: the 3 panes come back inline with their conversations", async () => {
    const det = await detachedPage();
    assert(det, "the detached window disappeared before the attach");
    const btn = det.locator('button[title*="Reattach"]').first();
    assert(await btn.count(), "no Reattach button in the detached window");
    await btn.click();
    await main.waitForTimeout(2500);
    const dets = await detachedTargets();
    assert(dets.length === 0, `the detached window is still open (${dets.length})`);
    const n = await main.locator(".xterm").count();
    assert(n === 3, `after attach expected 3 inline panes, got ${n}`);
    const txts = await allXtermText(main);
    for (let i = 0; i < 3; i++) {
      assert(
        (txts[i] ?? "").includes(`ACK-PANE-${i + 1}`),
        `pane ${i + 1} conversation did NOT persist through the attach`,
      );
    }
    await shot(main, "07-attach-3panes-persistidos");
  });

  await step("S8 — final global verification", async () => {
    await shot(main, "08-final");
    if (fails.length > 0) throw new Error(`FAILURES: ${fails.join(" | ")}`);
  });

  console.log("NOTES:", notes.join("; "));
});
