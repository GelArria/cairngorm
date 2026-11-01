// Real Tauri dev OR packaged window, CDP :9222 — no Tauri mocks.
// Run: node tests/native/gem-animation.cjs. Preferences are restored afterward.
const { chromium, expect } = require("@playwright/test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

function showWindow(state) {
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class GemWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); }';
    $p = Get-Process cairngorm -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;
    if (!$p) { throw 'No Cairngorm window' }; [GemWindow]::ShowWindow($p.MainWindowHandle, ${state}) | Out-Null;
    [GemWindow]::IsIconic($p.MainWindowHandle);
  `,
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
  return output.trim() === "True";
}

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) =>
      /^(http:\/\/localhost:1420|http:\/\/tauri\.localhost|tauri:\/\/localhost)/.test(p.url()),
    );
  if (!page) {
    await browser.close();
    throw new Error("Real Tauri page not found");
  }
  const saved = await page.evaluate(() =>
    Object.fromEntries(
      ["gem-display", "sidebar-collapsed", "show-splash"].map((key) => [
        key,
        localStorage.getItem(key),
      ]),
    ),
  );
  const hero = page.locator('[data-testid="active-project"] .project-gem');
  const selected = page.locator('[data-testid^="project-box-"][aria-current="true"] .project-gem');
  const pose = (gem) => gem.evaluate((svg) => svg.innerHTML);
  const turns = async (gem) => {
    await expect(gem).toBeVisible();
    const before = await pose(gem);
    await expect.poll(() => pose(gem)).not.toBe(before);
  };
  try {
    console.log("Native webview:", page.url());
    await page.evaluate(() => {
      localStorage.setItem(
        "gem-display",
        JSON.stringify({ heroCard: true, frozen: false, forceMotion: false }),
      );
      localStorage.setItem("sidebar-collapsed", "false");
      localStorage.setItem("show-splash", "false");
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(hero).toBeVisible({ timeout: 15000 });
    const still = await pose(hero);
    await page.waitForTimeout(200);
    expect(await pose(hero)).toBe(still);
    await page.locator('[data-testid="active-project-card"]').click({ button: "right" });
    await page.getByRole("menuitem", { name: "Unfreeze 3D Rotation" }).click();
    await page.mouse.move(1000, 700);
    await turns(hero);
    await turns(selected);
    await page.reload();
    await turns(hero);
    await turns(selected);
    console.log("PASS native explicit unfreeze under reduced motion + reload persistence");
    await page.locator('[data-testid="sidebar-collapse"]').click();
    await turns(page.locator('[data-testid^="rail-project-"][aria-current="true"] .project-gem'));
    await page.locator('[data-testid="sidebar-expand"]').click();
    await turns(hero);
    console.log("PASS native collapsed/expanded rotation");

    for (let n = 0; n < 3; n++) {
      // CDP-attached WebView2 need not mark the document hidden; verify the
      // actual Win32 window state instead of assuming browser-tab semantics.
      expect(showWindow(6)).toBe(true); // SW_MINIMIZE
      await page.waitForTimeout(200);
      expect(showWindow(9)).toBe(false); // SW_RESTORE
      await turns(hero);
      await turns(selected);
    }
    console.log("PASS native minimize/restore: 3/3, geometry changes after restore");
    fs.mkdirSync("logs/e2e", { recursive: true });
    const box = await page.locator('[data-testid="sidebar"]').boundingBox();
    const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(350, box.height) };
    await page.screenshot({ path: "logs/e2e/gem-native-before.png", clip });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "logs/e2e/gem-native-after.png", clip });
    console.log("PASS native screenshots saved in logs/e2e/gem-native-{before,after}.png");
  } finally {
    showWindow(9);
    try {
      await page.evaluate((prefs) => {
        for (const [key, value] of Object.entries(prefs)) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, saved);
      await page.emulateMedia({ reducedMotion: null });
      await page.reload();
    } finally {
      await browser.close();
    } // disconnect; do not quit the desktop app
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
