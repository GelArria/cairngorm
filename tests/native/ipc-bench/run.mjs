// node tests/native/ipc-bench/run.mjs [rounds=3] [MiB/session=2]
// Real Tauri/WebView2, isolated from the running app and its user data.
import { copyFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { profileNative } from "./profile.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = path.join(root, "logs/rust-performance/native-ipc");
const project = path.join(out, "backend");
const rustPath = (p) => JSON.stringify(p.replaceAll("\\", "/"));
const rounds = Number(process.argv[2] ?? 3),
  mib = Number(process.argv[3] ?? 2);
if (
  !Number.isInteger(rounds) ||
  rounds < 1 ||
  rounds > 5 ||
  !Number.isInteger(mib) ||
  mib < 1 ||
  mib > 8
)
  throw new Error("Invalid benchmark size/rounds");
mkdirSync(path.join(project, "src"), { recursive: true });
try {
  await fetch("http://127.0.0.1:9333/json/version");
  throw new Error("CDP 9333 occupied; refusing to attach to another app");
} catch (e) {
  if (e.message.includes("occupied")) throw e;
}
const source = readFileSync(path.join(root, "src/terminal/native/pty.rs"), "utf8").replaceAll(
  "\r\n",
  "\n",
);
const start = source.indexOf("fn emit_terminal_output("),
  end = source.indexOf("\n#[derive(Serialize, Clone)]\npub struct PtyDataPayload", start);
if (start < 0 || end < 0) throw new Error("Cannot locate the production output emitter");
writeFileSync(
  path.join(project, "src/app/main.rs"),
  `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use serde::Serialize;
#[path = ${rustPath(path.join(root, "src/terminal/native/pty_output.rs"))}] mod output;
use output::{PtyOutput, OUTPUT_CAP};
#[derive(Serialize, Clone)] struct PtyDataPayload { data: String }
${source.slice(start, end)}
#[path = ${rustPath(path.join(root, "tests/native/ipc-bench/transport.rs"))}] mod transport;
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![transport::bench_stream, transport::bench_ping])
        .run(tauri::generate_context!()).expect("native benchmark failed");
}
`,
);
writeFileSync(
  path.join(project, "Cargo.toml"),
  `[package]
name = "cairngorm-ipc-bench"
version = "0.0.0"
edition = "2021"
[build-dependencies]
tauri-build = "=2.6.0"
[dependencies]
tauri = { version = "=2.11.0", features = ["image-png"] }
serde = { version = "=1.0.228", features = ["derive"] }
base64 = "=0.22.1"
`,
);
writeFileSync(path.join(project, "build.rs"), "fn main() { tauri_build::build() }\n");
copyFileSync(path.join(root, "src-tauri/Cargo.lock"), path.join(project, "Cargo.lock"));
writeFileSync(
  path.join(project, "tauri.conf.json"),
  JSON.stringify(
    {
      productName: "Cairngorm IPC benchmark",
      version: "0.0.0",
      identifier: "com.cairngorm.test.ipc",
      build: { devUrl: "http://127.0.0.1:1432/tests/native/ipc-bench/" },
      bundle: { active: false, icon: [path.join(root, "src-tauri/icons/icon.ico")] },
      app: {
        withGlobalTauri: true,
        security: {
          capabilities: [{ identifier: "bench", windows: ["main"], permissions: ["core:default"] }],
        },
        windows: [
          {
            label: "main",
            title: "Cairngorm IPC benchmark (isolated)",
            width: 1000,
            height: 700,
            additionalBrowserArgs:
              "--remote-debugging-port=9333 --remote-allow-origins=* --disable-background-timer-throttling --disable-renderer-backgrounding",
          },
        ],
      },
    },
    null,
    2,
  ),
);
const target = path.join(root, "src-tauri/target");
const build = spawnSync(
  "cargo",
  [
    "build",
    "--release",
    "--offline",
    "--manifest-path",
    path.join(project, "Cargo.toml"),
    "--target-dir",
    target,
  ],
  { cwd: root, encoding: "utf8", timeout: 480_000 },
);
writeFileSync(path.join(out, "build.log"), `${build.stdout ?? ""}${build.stderr ?? ""}`);
if (build.error || build.status !== 0)
  throw new Error(`Native harness build failed: ${build.error ?? build.stderr}`);
let server, app, browser;
const nativeLog = createWriteStream(path.join(out, "native.log"));
try {
  server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(out, "vite-cache"),
    server: { host: "127.0.0.1", port: 1432, strictPort: true },
    optimizeDeps: {
      entries: ["tests/native/ipc-bench/index.html"],
      include: ["@xterm/xterm", "@xterm/addon-serialize"],
    },
  });
  await server.listen();
  app = spawn(
    path.join(
      target,
      "release",
      process.platform === "win32" ? "cairngorm-ipc-bench.exe" : "cairngorm-ipc-bench",
    ),
    [],
    { cwd: project },
  );
  app.stdout.pipe(nativeLog, { end: false });
  app.stderr.pipe(nativeLog, { end: false });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) throw new Error(`Native app exited (${app.exitCode})`);
    try {
      const res = await fetch("http://127.0.0.1:9333/json/version");
      ready = res.ok;
    } catch {}
    if (ready) break;
    await delay(500);
  }
  if (!ready) throw new Error("Native WebView2 CDP did not start");
  browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes("1432"));
  if (!page) throw new Error("Isolated benchmark page missing");
  page.on("pageerror", (error) => console.error("[pageerror]", error.message));
  const trace = createWriteStream(path.join(out, "samples.log"));
  page.on("console", (message) => {
    if (message.text().startsWith("[IPC-BENCH]")) trace.write(message.text() + "\n");
  });
  await page.waitForFunction(() => window.__IPC_BENCH_READY__, null, { timeout: 30_000 });
  const evidence = await page.evaluate((options) => window.runBenchSuite(options), { rounds, mib });
  trace.end();
  evidence.buildProfile =
    "release, same installed Tauri 2.11.0 + WebView2; no app plugins/PTY OS I/O";
  writeFileSync(path.join(out, "results.json"), JSON.stringify(evidence, null, 2));
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const summaries = [];
  for (const render of [false, true])
    for (const sessions of [1, 4])
      for (const mode of ["events", "coalesced", "raw", "raw-batch"]) {
        const rows = evidence.results.filter(
          (r) => r.render === render && r.sessions === sessions && r.mode === mode,
        );
        summaries.push({
          mode,
          sessions,
          xterm: render,
          ms: +median(rows.map((r) => r.drainedMs)).toFixed(1),
          mib_s: +median(rows.map((r) => r.mibPerSec)).toFixed(1),
          callbacks: median(rows.map((r) => r.callbacks)),
          frameMaxMs: +median(rows.map((r) => r.frameMaxMs)).toFixed(1),
          pingP95Ms: +median(rows.map((r) => r.pingP95Ms)).toFixed(1),
        });
      }
  writeFileSync(path.join(out, "summary.json"), JSON.stringify(summaries, null, 2));
  console.table(summaries);
  const golden = evidence.results.find(
    (r) => r.mode === "coalesced" && r.render && r.sessions === 4,
  ).screenHash;
  const profiles = await profileNative(page, out, mib, golden);
  console.table(
    ["transport", "xterm", "xterm-monitor"].map((scenario) => {
      const rows = profiles.filter((r) => r.scenario === scenario);
      return {
        scenario,
        ms: +median(rows.map((r) => r.drainedMs)).toFixed(1),
        xtermCpuMs: +median(rows.map((r) => r.xtermMs)).toFixed(1),
        monitorCpuMs: +median(rows.map((r) => r.testMonitorMs)).toFixed(1),
        frameMaxMs: +median(rows.map((r) => r.frameMaxMs)).toFixed(1),
      };
    }),
  );
  console.log(
    `PASS: ${evidence.results.length} native runs, exact bytes, ordered EOF and identical xterm screens; ${profiles.length} CPU profiles. Evidence: ${out}`,
  );
} finally {
  await browser?.close().catch(() => {});
  app?.kill();
  nativeLog.end();
  await server?.close();
}
