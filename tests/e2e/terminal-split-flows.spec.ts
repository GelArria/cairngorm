// Terminal split flows driven with REAL CLICKS (like a human),
// against the Tauri app running with CDP 9222 (E2E_REAL=1).
// Verifies: split ×4, clicks across tabs, close/reopen, detach/reattach.
// Note: the browser serializes gridColumn/gridRow as "grid-area" in the style attr.
//
// ⚠ KNOWN: with the CDP client attached, closing the AGENT tab (sidecar pty_kill)
// or creating the 2nd window (detach) can hang WebView2 intermittently
// (app "Not Responding") — does not reproduce without a debugger. If the suite
// freezes at close-all, relaunch the app and retry.
import { test as base, expect, type Browser, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { arrange, splitNew } from "./split-helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP = "http://127.0.0.1:9222";
const SHOTS = path.resolve(__dirname, "../../logs/e2e/split-flows");
fs.mkdirSync(SHOTS, { recursive: true });

let _browser: Browser | null = null;
let _main: Page | null = null;

async function browser(): Promise<Browser> {
  if (_browser) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.connectOverCDP(CDP);
  return _browser;
}

async function getMain(): Promise<Page> {
  if (_main) return _main;
  const b = await browser();
  const pages = b.contexts()[0].pages();
  _main = pages.find((p) => p.url().includes("1420") && !p.url().includes("detached")) ?? pages[0];
  return _main;
}

async function shot(page: Page, name: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const res = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.data, "base64"));
  console.log(`[SHOT] ${file}`);
}

async function detachedTargets(): Promise<{ id: string; url: string }[]> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 3000);
  try {
    const resp = await fetch(`${CDP}/json/list`, { signal: ctrl.signal });
    const all = await resp.json();
    return all
      .filter((t: any) => t.type === "page" && t.url.includes("detached="))
      .map((t: any) => ({ id: t.id, url: t.url }));
  } catch {
    return [];
  } finally {
    clearTimeout(to);
  }
}

// ── Click helpers (real interaction, no evaluate) ───────────────────────────

/** Bar tabs: buttons carrying the status dot (span.rounded-full) */
function tabButtons(page: Page) {
  return page.locator("button:has(span.rounded-full)");
}

async function clickSplit(page: Page) {
  await splitNew(page);
}

async function openShell(page: Page) {
  // close a previous dropdown if it stayed open (click outside)
  await page.mouse.click(200, 400);
  await page.waitForTimeout(200);
  await page.locator('button[aria-label="New terminal"]').click();
  await page.waitForTimeout(400);
  // first dropdown item: detected shells (PowerShell…) or fallback
  await page.locator("div.fixed div.cursor-pointer").first().click();
  await page.waitForTimeout(1200);
  await expect(page.locator(".xterm").first()).toBeVisible({ timeout: 15000 });
}

/** Grid state: children of the grid container with their grid-area */
async function gridState(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('[style*="grid-template-columns"]');
    if (!container)
      return { cells: 0, withArea: 0, visibleXterms: 0, distinctLefts: 0, overlap: false };
    const wrappers = Array.from(container.children) as HTMLElement[];
    const rects = wrappers.map((w) => {
      const r = w.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top) };
    });
    const xt = Array.from(document.querySelectorAll(".xterm")) as HTMLElement[];
    let overlap = false;
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        if (
          Math.abs(rects[i].left - rects[j].left) < 5 &&
          Math.abs(rects[i].top - rects[j].top) < 5
        )
          overlap = true;
    return {
      cells: wrappers.length,
      withArea: wrappers.filter((w) => (w.getAttribute("style") || "").includes("grid-area"))
        .length,
      visibleXterms: xt.filter((x) => x.offsetWidth > 0 && x.offsetHeight > 0).length,
      distinctLefts: new Set(rects.map((r) => r.left)).size,
      overlap,
    };
  });
}

/** Reset to exactly 1 tab without layout (dissolves split, closes tabs, opens shell) */
async function resetToOne(page: Page) {
  const reBtn = page.locator('button[title="Remove split"]');
  if ((await reBtn.count()) > 0) {
    await reBtn.click();
    await page.waitForTimeout(400);
  }
  for (let i = 0; i < 10; i++) {
    const closeBtns = page.locator("button:has(span.rounded-full) span:has-text('×')");
    if ((await closeBtns.count()) === 0) break;
    await closeBtns.first().click();
    await page.waitForTimeout(400);
  }
  await openShell(page);
}

const test = base.extend<{ main: Page }>({});

test.describe.configure({ mode: "serial" });

test.describe("Terminal splits with real clicks", () => {
  let main: Page;

  test.beforeAll(async () => {
    test.skip(process.env.E2E_REAL !== "1", "requires real Tauri app with CDP 9222 (E2E_REAL=1)");
    main = await getMain();
    // Reset: dissolve a previous split, close all tabs, reattach orphans
    const reBtn = main.locator('button[title="Remove split"]');
    if ((await reBtn.count()) > 0) {
      await reBtn.click();
      await main.waitForTimeout(400);
    }
    for (const t of await detachedTargets()) {
      const detPage = (await browser())
        .contexts()[0]
        .pages()
        .find((p) => p.url() === t.url);
      if (detPage) {
        const btn = detPage.locator('button[title*="Reattach"]');
        if ((await btn.count()) > 0) {
          await btn.click();
          await main.waitForTimeout(1000);
        }
      }
    }
    for (let i = 0; i < 10; i++) {
      const closeBtns = main.locator("button:has(span.rounded-full) span:has-text('×')");
      if ((await closeBtns.count()) === 0) break;
      await closeBtns.first().click();
      await main.waitForTimeout(400);
    }
    await openShell(main); // exactly 1 tab, no layout
  });

  test("split ×4 and clicks across tabs: all 5 panes visible, no overlaps", async () => {
    test.setTimeout(120000);
    for (let i = 0; i < 4; i++) {
      await clickSplit(main);
      await main.waitForTimeout(500);
    }
    await shot(main, "01-split-x4");

    let g = await gridState(main);
    expect(g.cells).toBe(5);
    expect(g.withArea).toBe(5); // each pane with an assigned cell
    expect(g.visibleXterms).toBe(5);
    expect(g.overlap).toBe(false);
    expect(g.distinctLefts).toBeGreaterThanOrEqual(4); // distinct columns

    // Clicks across tabs — geometry does not change and everything stays visible
    const n = await tabButtons(main).count();
    expect(n).toBe(5);
    for (let i = 0; i < n; i++) {
      await tabButtons(main).nth(i).click();
      await main.waitForTimeout(250);
      const gi = await gridState(main);
      expect(gi.cells).toBe(5);
      expect(gi.visibleXterms).toBe(5);
      expect(gi.overlap).toBe(false);
    }
    await shot(main, "02-clicks-tabs");
  });

  test("close all → reopen → split ×2: clean shared layout", async () => {
    test.setTimeout(120000);
    await resetToOne(main);
    await clickSplit(main);
    await main.waitForTimeout(500);
    await clickSplit(main);
    await main.waitForTimeout(500);
    const g = await gridState(main);
    expect(g.cells).toBe(3);
    expect(g.withArea).toBe(3);
    expect(g.visibleXterms).toBe(3);
    expect(g.overlap).toBe(false);
    await shot(main, "03-reopen-split-x2");
  });

  // NOTE: the devtools plugin (crabnebula) used to hang WebView2 when creating the 2nd window
  // (wry::custom_protocol::handle stuck — see dashboard Calls). It is now opt-in
  // (PANEL_DEVTOOLS=1); with the plugin OFF, detach/reattach works even with CDP.
  test("active pane outline: click inside a pane activates it", async () => {
    test.setTimeout(60000);
    await resetToOne(main);
    // 3 panes via 2 splits on the active tab
    for (let i = 0; i < 2; i++) {
      await clickSplit(main);
      await main.waitForTimeout(500);
    }
    const readActive = async () =>
      main.evaluate(() => {
        const container = document.querySelector('[style*="grid-template-columns"]');
        const kids = Array.from((container ?? document.body).children);
        const paneIdx = kids.findIndex((k) => String(k.className).includes("outline-primary"));
        const dots = Array.from(document.querySelectorAll("button span.rounded-full"));
        const tabIdx = dots.findIndex((s) =>
          String(s.closest("button")?.className).includes(" bg-black"),
        );
        return { paneIdx, tabIdx, cells: kids.length };
      });

    const before = await readActive();
    expect(before.cells).toBe(3);

    // click inside pane 2 → its tab activates and the outline moves there
    await main
      .locator('[style*="grid-template-columns"] > div')
      .nth(1)
      .click({ position: { x: 40, y: 40 } });
    await main.waitForTimeout(300);
    let r = await readActive();
    expect(r.paneIdx, "pane 2 with active outline").toBe(1);
    expect(r.tabIdx, "tab 2 active in the bar").toBe(1);

    // click inside pane 3 → outline follows the click
    await main
      .locator('[style*="grid-template-columns"] > div')
      .nth(2)
      .click({ position: { x: 40, y: 40 } });
    await main.waitForTimeout(300);
    r = await readActive();
    expect(r.paneIdx).toBe(2);
    expect(r.tabIdx).toBe(2);
    await shot(main, "06-outline-active-pane");

    // Split group in the bar: pill with the 3 tabs in grid order, contiguous
    const grp = main.locator("[data-split-group]");
    expect(await grp.count(), "split group exists").toBe(1);
    expect(await grp.locator("button").count(), "3 tabs inside the group").toBe(3);
    const titles = await grp.locator("button span.truncate").allTextContents();
    expect(titles.length).toBe(3);
    expect(
      await main.locator("[data-split-group] ~ * button:has(span.truncate)").count(),
      "no tabs outside the group",
    ).toBe(0);

    // Horizontal split of the selected tab → new row below (2-row grid)
    await splitNew(main);
    await arrange(main, "Mosaic grid");
    await main.waitForTimeout(400);
    const rows = await main.evaluate(
      () =>
        (document.querySelector('[style*="grid-template-rows"]') as HTMLElement | null)?.style
          .gridTemplateRows ?? "",
    );
    expect(rows, "grid with 2 rows after horizontal split").toContain("repeat(2");
    const afterH = await readActive();
    expect(afterH.cells, "4 panes").toBe(4);
    expect(afterH.paneIdx, "the new pane (below) is active with outline").toBe(3);
    await shot(main, "07-split-horizontal");
  });

  test("split in tabs mode (2 shells, no layout) → all 3 panes visible in grid", async () => {
    test.setTimeout(60000);
    await resetToOne(main);
    // Second shell → tabs mode (no grid): 2 tabs, 0 cells
    await openShell(main);
    let g = await gridState(main);
    expect(g.cells, "tabs mode: no grid").toBe(0);
    const tabCount = await tabButtons(main).count();
    expect(tabCount).toBe(2);

    // Split of the active → the OTHER tab also gets a cell (it used to stay invisible)
    await clickSplit(main);
    await main.waitForTimeout(600);
    g = await gridState(main);
    expect(g.cells, "3 panes: active + new + the other tab").toBe(3);
    expect(g.withArea).toBe(3);
    expect(g.visibleXterms, "no invisible tabs").toBe(3);
    expect(g.overlap).toBe(false);
    await shot(main, "08-split-tabs-mode");
  });

  test("closing the MIDDLE pane compacts columns (no dead column)", async () => {
    test.setTimeout(60000);
    await resetToOne(main);
    await clickSplit(main);
    await main.waitForTimeout(500);
    await clickSplit(main);
    await main.waitForTimeout(500);
    let g = await gridState(main);
    expect(g.cells).toBe(3);

    // The middle tab in the bar (grid order: A, C, B → C is 2nd)
    const midClose = main.locator("button:has(span.rounded-full) span:has-text('×')").nth(1);
    await midClose.click();
    await main.waitForTimeout(600);

    g = await gridState(main);
    expect(g.cells, "2 panes remain").toBe(2);
    expect(g.visibleXterms).toBe(2);
    expect(g.overlap).toBe(false);
    const cols = await main.evaluate(
      () =>
        (document.querySelector('[style*="grid-template-columns"]') as HTMLElement | null)?.style
          .gridTemplateColumns ?? "",
    );
    const frs = cols.split(" ").filter((s) => s.includes("fr"));
    expect(frs.length, "2-column grid, not 3 with a hole").toBe(2);
    await shot(main, "09-mid-close-compacts");
  });

  test("resize handle drag: ratios change and persist across tab switches", async () => {
    test.setTimeout(60000);
    await resetToOne(main);
    await clickSplit(main);
    await main.waitForTimeout(600);
    const readCols = async () =>
      main.evaluate(() => {
        const el = document.querySelector('[style*="grid-template-columns"]') as HTMLElement | null;
        return (el?.style.gridTemplateColumns ?? "")
          .split(" ")
          .filter((s) => s.includes("fr"))
          .map((s) => parseFloat(s));
      });
    const before = await readCols();
    expect(before.length).toBe(2);
    expect(before[0]).toBeCloseTo(before[1]);

    // Real drag of the GRID resize handle (not the sidebar one, which shares the class)
    const handle = main.locator('[style*="grid-template-columns"] .cursor-col-resize').first();
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();
    await main.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await main.mouse.down();
    await main.mouse.move(box!.x + box!.width / 2 + 200, box!.y + box!.height / 2, { steps: 12 });
    await main.mouse.up();
    await main.waitForTimeout(400);
    const after = await readCols();
    expect(after[0], "col 0 grew with the drag").toBeGreaterThan(after[1]);

    // Click tab 2 → the custom ratio persists (shared layout)
    await tabButtons(main).nth(1).click();
    await main.waitForTimeout(300);
    const afterSwitch = await readCols();
    expect(afterSwitch[0]).toBeCloseTo(after[0]);
    await shot(main, "10-resize-drag-persistente");
  });

  test("detach of a split tab → reattach: comes back with a cell in the grid", async () => {
    test.setTimeout(120000);
    const pre = await detachedTargets();
    await main.locator('button[title*="Detach"]').click();
    let det: { id: string } | undefined;
    for (let i = 0; i < 16; i++) {
      await main.waitForTimeout(500);
      const post = await detachedTargets();
      det = post.find((t) => !pre.some((p) => p.id === t.id));
      if (det) break;
    }
    expect(det, "detached window appeared").toBeTruthy();
    await main.waitForTimeout(800);

    // With 1 inline the split dissolves; reopen a shell and split again
    await openShell(main);
    await clickSplit(main);
    await main.waitForTimeout(500);
    let g = await gridState(main);
    expect(g.cells).toBe(2);
    expect(g.visibleXterms).toBe(2);
    await shot(main, "04-detached-and-split");

    // Reattach from the detached window (real click)
    const detPage = (await browser())
      .contexts()[0]
      .pages()
      .find((p) => p.url().includes("detached="));
    expect(detPage).toBeTruthy();
    await detPage!.locator('button[title*="Reattach"]').click();
    await main.waitForTimeout(2000);

    // Key invariant of the fix: the reattached tab HAS a cell (3 cells, 3 visible)
    g = await gridState(main);
    expect(g.cells).toBe(3);
    expect(g.withArea).toBe(3);
    expect(g.visibleXterms).toBe(3);
    expect(g.overlap).toBe(false);
    await shot(main, "05-reattach-with-cell");
  });
});
