// Build and exercise an isolated dev app; never stop/attach to the installed Cairngorm.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const root = process.cwd();
const endpoint = "http://127.0.0.1:9224";
for (const url of [endpoint + "/json/version", "http://localhost:1420"]) {
  const occupied = await fetch(url).then(
    () => true,
    () => false,
  );
  assert.equal(occupied, false, `Refusing to use an occupied QA endpoint: ${url}`);
}
const config = JSON.parse(fs.readFileSync("logs/build/workspace-restore-native.json", "utf8"));
config.productName = "Cairngorm Observer QA";
config.identifier += ".observer";
const env = {
  ...process.env,
  TAURI_CONFIG: JSON.stringify(config),
  NATIVE_CDP_URL: endpoint,
  OLLAMA_API_KEY: "",
};
const dir = path.resolve("logs/build/test-monitor-native");
fs.mkdirSync(dir, { recursive: true });
execFileSync(
  "cargo",
  ["build", "--manifest-path", "src-tauri/Cargo.toml", "--no-default-features"],
  { env, stdio: "inherit" },
);
const executable = path.join(dir, "cairngorm.exe");
fs.copyFileSync("src-tauri/target/debug/cairngorm.exe", executable);
for (const file of ["conpty.dll", "OpenConsole.exe"])
  fs.copyFileSync(`src-tauri/resources/conpty/${file}`, path.join(dir, file));
const frontendLog = fs.openSync("logs/optimization-native-vite.log", "w");
const appLog = fs.openSync("logs/optimization-native-app.log", "w");
const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--port", "1420", "--strictPort"],
  { cwd: root, env: { ...env, E2E_TEST: "" }, stdio: ["ignore", frontendLog, frontendLog] },
);
let app;
let browser;
const completed = new Map();
function track(child) {
  const done = new Promise((resolve) => child.once("exit", resolve));
  completed.set(child, done);
}
track(vite);
try {
  for (let i = 0; i < 100; i++) {
    if (
      await fetch("http://localhost:1420").then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (vite.exitCode !== null) throw new Error("Native Vite exited");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  app = spawn(executable, [], { cwd: dir, env, stdio: ["ignore", appLog, appLog] });
  track(app);
  console.log(`QA app started pid=${app.pid}`);
  for (let i = 0; i < 200; i++) {
    try {
      browser = await chromium.connectOverCDP(endpoint);
      break;
    } catch {}
    if (app.exitCode !== null) throw new Error("QA app exited");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(browser, "Native CDP did not start");
  const page = browser.contexts()[0].pages()[0];
  console.log("QA CDP connected");
  await page.waitForURL("http://localhost:1420/");
  console.log("QA frontend loaded");
  await page.evaluate(() => {
    localStorage.setItem("show-splash", "false");
    localStorage.setItem("sidebar-side", "left");
  });
  await page.reload();
  await page.getByTestId("sidebar").waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  await browser.close();
  browser = undefined;
  console.log("QA sidebar ready");
  const commands =
    process.argv.length > 2
      ? process.argv.slice(2).map((file) => [file])
      : [
          ["tests/native/test-monitor-native.mjs"],
          ["tests/native/storage-native.mjs"],
          [
            "node_modules/playwright/cli.js",
            "test",
            "-c",
            "tests/playwright.visual-native.config.ts",
            "--reporter=line",
          ],
          [
            "node_modules/playwright/cli.js",
            "test",
            "-c",
            "tests/playwright.terminal.config.ts",
            "--reporter=line",
          ],
          ["tests/native/terminal-first-key.mjs"],
        ];
  let failed = false;
  for (const args of commands) {
    console.log(`QA command: ${args.join(" ")}`);
    try {
      execFileSync(process.execPath, args, {
        env,
        cwd: root,
        stdio: "inherit",
        timeout: Number(env.CAIRNGORM_NATIVE_TIMEOUT_MS ?? 120000),
      });
    } catch (error) {
      console.error(`FAILED ${args.join(" ")}: exit ${error.status}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  for (const child of [app, vite])
    if (child) {
      if (child.exitCode === null) child.kill();
      await completed.get(child);
    }
  fs.closeSync(frontendLog);
  fs.closeSync(appLog);
}
