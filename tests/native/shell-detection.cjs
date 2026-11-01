// Real Windows/Tauri regression check (no mocks). App must expose CDP on :9222.
// Run: node tests/native/shell-detection.cjs; --control proves the window probe.
// --launch <exe> also checks a cold start (close any running Cairngorm first).
const { chromium, expect } = require("@playwright/test");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const dir = path.resolve("logs/e2e/shell-detection");
  fs.mkdirSync(dir, { recursive: true });
  const ready = path.join(dir, "ready");
  const stop = path.join(dir, "stop");
  const out = path.join(dir, "windows.json");
  for (const file of [ready, stop, out]) fs.rmSync(file, { force: true });
  const watcher = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      "tests/native/watch-console-windows.ps1",
      "-Ready",
      ready,
      "-Stop",
      stop,
      "-Out",
      out,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let errors = "";
  watcher.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const finished = new Promise((resolve, reject) => {
    watcher.on("error", reject);
    watcher.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Probe exited ${code}: ${errors}`)),
    );
  });
  // Observe watcher failure even if CDP/another assertion fails first.
  finished.catch(() => {});
  let browser;
  try {
    await expect.poll(() => fs.existsSync(ready), { timeout: 15000 }).toBe(true);
    if (process.argv.includes("--control")) {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Start-Process cmd.exe -ArgumentList '/c ping -n 2 127.0.0.1 >nul' -Wait",
        ],
        { windowsHide: true },
      );
    } else {
      const launchIndex = process.argv.indexOf("--launch");
      if (launchIndex !== -1) {
        const exe = process.argv[launchIndex + 1];
        assert(exe && fs.existsSync(exe), "--launch needs an existing executable");
        const app = spawn(path.resolve(exe), [], {
          windowsHide: true,
          detached: true,
          stdio: "ignore",
        });
        app.unref();
        await expect
          .poll(
            async () => {
              try {
                return (await fetch("http://127.0.0.1:9222/json/version")).ok;
              } catch {
                return false;
              }
            },
            { timeout: 20000 },
          )
          .toBe(true);
      }
      browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      await expect.poll(() => browser.contexts()[0].pages().length).toBeGreaterThan(0);
      const page = browser
        .contexts()[0]
        .pages()
        .find((p) => !p.url().startsWith("devtools:"));
      assert(page, "Real Tauri page not found");
      await expect(page.getByTestId("header-settings")).toBeVisible({ timeout: 20000 });
      // Reload remounts TerminalTabs, reproducing startup's native detection.
      await page.reload();
      await expect(page.getByTestId("header-settings")).toBeVisible({ timeout: 20000 });
      const shells = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("detect_shells"));
      assert(
        shells.some((s) => s.name === "PowerShell"),
        "PowerShell detection broken",
      );
      assert(
        shells.some((s) => s.name === "Command Prompt"),
        "CMD detection broken",
      );
      for (let n = 0; n < 3; n++) {
        // Await each real IPC response, not the shell list cached in Settings.
        const detection = page.waitForResponse((r) => r.url().endsWith("/detect_shells"));
        await page.getByTestId("header-settings").click();
        const response = await detection;
        assert.equal(response.status(), 200);
        assert.deepEqual(await response.json(), shells);
        await expect(page.locator("#terminal-default-shell")).toBeEnabled();
        await expect(
          page.getByTestId("settings-dialog").getByText("Detecting…", { exact: true }),
        ).toHaveCount(0);
        await page
          .getByTestId("settings-dialog")
          .getByRole("button", { name: "Close", exact: true })
          .click();
      }
      console.log("Shells:", shells.map((s) => s.name).join(", "));
    }
    // Let out-of-context WinEvent callbacks drain before unhooking.
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    fs.writeFileSync(stop, "stop");
    try {
      await finished;
    } finally {
      if (browser) await browser.close();
    } // disconnect only
  }
  const flashes = JSON.parse(fs.readFileSync(out, "utf8").replace(/^\uFEFF/, ""));
  if (process.argv.includes("--control")) {
    assert(flashes.length > 0, "Probe missed the deliberately opened console");
    console.log(`PASS positive control: ${flashes.length} console window(s) detected`);
  } else {
    assert.deepEqual(flashes, [], `Visible console flashes: ${JSON.stringify(flashes)}`);
    console.log(
      "PASS startup + remount + native detect_shells + Settings 3/3: zero console windows",
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
