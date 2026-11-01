// Windows-only resource baseline for the whole Cairngorm process tree (app, WebView2, shells).
// Build first, into its own target dir so the installer binary is not replaced:
//   CARGO_TARGET_DIR=src-tauri/target/perf-baseline npx tauri build --no-bundle --config tests/tauri.fresh-profile.json
//   node tests/guard-cairngorm.mjs --isolated-browser --receipt logs/perf-baseline/guard.json -- node tests/native/resource-baseline.mjs [runs]
// Only the child started here (and its own descendants) is ever closed.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { freshProfileEnv } from "./fresh-profile-env.mjs";

assert.equal(process.platform, "win32");
const executable = path.resolve(
  process.env.CAIRNGORM_PERF_BINARY ?? "src-tauri/target/perf-baseline/release/cairngorm.exe",
);
assert(
  fs.readFileSync(executable).includes(Buffer.from("dev.cairngorm.fresh-profile")),
  "Build the QA identifier first; refusing to launch an installed-profile binary",
);
const endpoint = "http://127.0.0.1:9337";
const runs = Number(process.argv[2] ?? 1);
const outDir = path.resolve(`logs/perf-baseline/${new Date().toISOString().replace(/[:.]/g, "-")}`);
const TERMINALS = 4;
const SETTLE_MS = 10_000;
const WINDOW_MS = 30_000;
const HEAVY_TIMEOUT_MS = 120_000;

/** Every process on the machine; CPU times are in 100 ns units, memory in bytes. */
function processTable() {
  const script =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime | ConvertTo-Json -Compress";
  const rows = JSON.parse(
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      maxBuffer: 64 << 20,
    }),
  );
  return { at: Date.now(), rows };
}

/** The root and all its descendants, keyed by pid. */
function tree(table, rootPid) {
  const out = new Map();
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    const row = table.rows.find((r) => r.ProcessId === pid);
    if (!row || out.has(pid)) continue;
    out.set(pid, row);
    for (const child of table.rows) if (child.ParentProcessId === pid) queue.push(child.ProcessId);
  }
  return out;
}

// WebView2 children are split by Chromium role (browser, renderer, gpu-process, utility...).
const groupOf = (name, commandLine = "") =>
  /^cairngorm/i.test(name)
    ? "app"
    : /msedgewebview2/i.test(name)
      ? `webview:${commandLine?.match(/--type=([\w-]+)/)?.[1] ?? "browser"}`
      : /conhost|openconsole/i.test(name)
        ? "console"
        : /pwsh|powershell|cmd\.exe/i.test(name)
          ? "shells"
          : "other";

/** Samples the tree for `ms`; reports mean/peak private memory and CPU as % of one core. */
async function sampleWindow(rootPid, ms) {
  const samples = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    samples.push(processTable());
    await delay(2000);
  }
  samples.push(processTable());
  const groups = {};
  const add = (g, key, v) => {
    groups[g] ??= { privateMbMean: 0, privateMbPeak: 0, workingSetMbMean: 0, cpuPct: 0, procs: 0 };
    groups[g][key] += v;
  };
  const totals = samples.map((s) => {
    const byGroup = {};
    for (const row of tree(s, rootPid).values()) {
      const g = groupOf(row.Name, row.CommandLine);
      byGroup[g] ??= { priv: 0, ws: 0, procs: 0 };
      byGroup[g].priv += row.PrivatePageCount / 2 ** 20;
      byGroup[g].ws += row.WorkingSetSize / 2 ** 20;
      byGroup[g].procs += 1;
    }
    return byGroup;
  });
  for (const t of totals)
    for (const [g, v] of Object.entries(t)) {
      add(g, "privateMbMean", v.priv / totals.length);
      add(g, "workingSetMbMean", v.ws / totals.length);
      groups[g].privateMbPeak = Math.max(groups[g].privateMbPeak, v.priv);
      groups[g].procs = Math.max(groups[g].procs, v.procs);
    }
  const first = tree(samples[0], rootPid);
  const last = tree(samples.at(-1), rootPid);
  const seconds = (samples.at(-1).at - samples[0].at) / 1000;
  for (const [pid, row] of last) {
    const before = first.get(pid);
    if (!before || before.Name !== row.Name) continue;
    const cpu = row.KernelModeTime + row.UserModeTime - before.KernelModeTime - before.UserModeTime;
    add(groupOf(row.Name, row.CommandLine), "cpuPct", (cpu / 1e7 / seconds) * 100);
  }
  const sum = (key) => Object.values(groups).reduce((a, g) => a + g[key], 0);
  const round = (o) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  return {
    total: round({
      privateMbMean: sum("privateMbMean"),
      workingSetMbMean: sum("workingSetMbMean"),
      cpuPct: sum("cpuPct"),
      procs: sum("procs"),
    }),
    groups: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, round(v)])),
  };
}

async function pageMetrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return {
    jsHeapMb: Math.round((m.JSHeapUsedSize / 2 ** 20) * 10) / 10,
    domNodes: m.Nodes,
    listeners: m.JSEventListeners,
  };
}

async function dismissDialogs(page) {
  for (let i = 0; i < 10; i++) {
    const dialogs = page.getByRole("dialog");
    if ((await dialogs.count()) === 0) return;
    const notNow = page.getByRole("button", { name: "Not now", exact: true });
    if (await notNow.isVisible().catch(() => false)) await notNow.click();
    else await dialogs.last().getByRole("button", { name: "Close" }).first().click();
    await delay(1000);
  }
  assert.equal(await page.getByRole("dialog").count(), 0, "A first-run dialog stayed open");
}

async function runOnce(index) {
  const scratch = path.join(outDir, `run-${index}`);
  for (const dir of ["AppData/Roaming", "AppData/Local", ".pi/agent", ".claude", ".codex"])
    fs.mkdirSync(path.join(scratch, dir), { recursive: true });
  const heavyFile = path.join(scratch, "heavy.txt");
  const line =
    "0123456789 abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ \x1b[32mok\x1b[0m\r\n";
  fs.writeFileSync(heavyFile, line.repeat(100_000)); // ~8 MB with ANSI colour
  const env = freshProfileEnv(process.env, scratch, endpoint);
  const log = fs.openSync(path.join(scratch, "app.log"), "w");
  const started = performance.now();
  const app = spawn(executable, [], { env, stdio: ["ignore", log, log] });
  let lastTree = new Map();
  const result = { run: index };
  let browser;
  try {
    while (
      !(await fetch(`${endpoint}/json/version`).then(
        (r) => r.ok,
        () => false,
      ))
    ) {
      assert.equal(app.exitCode, null, "App exited before CDP was ready; see app.log");
      assert(performance.now() - started < 30_000, "CDP not ready within 30 s");
      await delay(50);
    }
    result.cdpReadyMs = Math.round(performance.now() - started);
    browser = await chromium.connectOverCDP(endpoint);
    const page = browser
      .contexts()[0]
      .pages()
      .find((p) => !p.url().startsWith("devtools"));
    await page.getByTestId("header-settings").waitFor({ timeout: 30_000 });
    result.uiReadyMs = Math.round(performance.now() - started);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    // First-run dialogs (agent onboarding, then consent prompts from its scan) open
    // asynchronously and stack; measure with none of them on screen.
    await delay(3000);
    await dismissDialogs(page);

    await delay(SETTLE_MS);
    result.idle = { ...(await sampleWindow(app.pid, WINDOW_MS)), page: await pageMetrics(cdp) };

    await dismissDialogs(page); // a late consent prompt can still arrive
    // One terminal, then three more into the same split so every pane is visible.
    for (let i = 0; i < TERMINALS; i++) {
      if (i === 0) {
        await page.getByRole("button", { name: "New terminal", exact: true }).first().click();
        await page
          .getByRole("menuitem", { name: /PowerShell|Default shell/i })
          .first()
          .click();
      } else {
        await page.getByRole("button", { name: /^(Split|Add to split)$/ }).click();
        await page.getByRole("menuitem", { name: "New terminal", exact: true }).click();
      }
      await page.locator("[data-pane-id]").nth(i).waitFor();
      await delay(1500);
    }
    await page.screenshot({ path: path.join(scratch, "terminals.png") });
    assert.equal(await page.locator("[data-pane-id]").count(), TERMINALS);
    await delay(SETTLE_MS);
    result.terminalsIdle = {
      ...(await sampleWindow(app.pid, WINDOW_MS)),
      page: await pageMetrics(cdp),
    };

    // Frame gaps while every terminal streams output at once.
    await page.evaluate(() => {
      const s = (window.__perfFrames = {
        frames: 0,
        maxGap: 0,
        over50: 0,
        last: performance.now(),
      });
      const tick = (now) => {
        const gap = now - s.last;
        s.frames++;
        s.maxGap = Math.max(s.maxGap, gap);
        if (gap > 50) s.over50++;
        s.last = now;
        if (!s.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const heavyStart = performance.now();
    for (let i = 0; i < TERMINALS; i++) {
      const marker = path.join(scratch, `done-${i}.txt`);
      await page.locator("[data-pane-id] .xterm").nth(i).click();
      await page.keyboard.type(`cmd /c type "${heavyFile}"; Set-Content "${marker}" ok`);
      await page.keyboard.press("Enter");
    }
    const sampling = sampleWindow(app.pid, 20_000);
    const drainMs = [];
    for (let i = 0; i < TERMINALS; i++) {
      const marker = path.join(scratch, `done-${i}.txt`);
      while (!fs.existsSync(marker)) {
        assert(performance.now() - heavyStart < HEAVY_TIMEOUT_MS, "Heavy output did not finish");
        await delay(100);
      }
      drainMs.push(Math.round(performance.now() - heavyStart));
    }
    const frames = await page.evaluate(() => {
      const s = window.__perfFrames;
      s.stop = true;
      return { frames: s.frames, maxGapMs: Math.round(s.maxGap), gapsOver50ms: s.over50 };
    });
    result.heavyOutput = {
      bytesPerTerminal: fs.statSync(heavyFile).size,
      drainMs,
      frames: { ...frames, seconds: Math.round((performance.now() - heavyStart) / 100) / 10 },
      ...(await sampling),
    };

    await delay(SETTLE_MS);
    result.afterOutputIdle = {
      ...(await sampleWindow(app.pid, WINDOW_MS)),
      page: await pageMetrics(cdp),
    };
    lastTree = tree(processTable(), app.pid);
  } catch (error) {
    result.error = String(error?.stack ?? error);
    try {
      const page = browser?.contexts()[0]?.pages()[0];
      await page?.screenshot({ path: path.join(scratch, "failure.png") });
    } catch {}
    lastTree = tree(processTable(), app.pid);
  } finally {
    await browser?.close().catch(() => {});
    // Exact child handle first, then only pids recorded in this run's own tree.
    if (app.exitCode === null) app.kill();
    await delay(3000);
    const now = processTable();
    for (const [pid, row] of lastTree) {
      // Same pid, name and start time: a recycled pid is never killed.
      const alive = now.rows.find(
        (r) =>
          r.ProcessId === pid &&
          r.Name === row.Name &&
          JSON.stringify(r.CreationDate) === JSON.stringify(row.CreationDate),
      );
      if (alive && pid !== app.pid) {
        try {
          process.kill(pid);
        } catch {}
      }
    }
    fs.closeSync(log);
  }
  return result;
}

fs.mkdirSync(outDir, { recursive: true });
assert(
  !(await fetch(`${endpoint}/json/version`).then(
    () => true,
    () => false,
  )),
  "QA port 9337 is occupied",
);
const results = [];
for (let i = 1; i <= runs; i++) {
  console.log(`[perf] run ${i}/${runs}`);
  results.push(await runOnce(i));
  fs.writeFileSync(
    path.join(outDir, "results.json"),
    JSON.stringify({ executable, results }, null, 2),
  );
}
console.log(JSON.stringify(results, null, 2));
console.log(`[perf] results: ${path.join(outDir, "results.json")}`);
process.exitCode = results.some((r) => r.error) ? 1 : 0;
