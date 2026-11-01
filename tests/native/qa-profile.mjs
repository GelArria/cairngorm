// Windows native acceptance tests own their process and profile, never the installed app.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { freshProfileEnv } from "./fresh-profile-env.mjs";

export async function within(operation, timeout, message) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function waitFor(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await within(Promise.resolve().then(check), deadline - Date.now(), message);
    if (result) return result;
    await delay(100);
  }
  throw new Error(message);
}

const normalize = (value) => value.replace(/\\/g, "/").toLowerCase();

export async function withQaProfile(name, run) {
  assert.equal(process.platform, "win32", "Native QA requires Windows");
  const executable = path.resolve("src-tauri/target/perf-baseline/release/cairngorm.exe");
  assert(
    fs.readFileSync(executable).includes(Buffer.from("dev.cairngorm.fresh-profile")),
    "Build the isolated release identifier first",
  );
  const endpoint = "http://127.0.0.1:9337";
  const listening = () =>
    fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }).then(
      () => true,
      () => false,
    );
  assert(!(await listening()), "QA port 9337 must be free before launch");
  fs.mkdirSync("logs/e2e", { recursive: true });
  const scratch = fs.mkdtempSync(path.resolve(`logs/e2e/${name}-`));
  for (const dir of ["AppData/Roaming", "AppData/Local", ".panel/agent", "project"]) {
    fs.mkdirSync(path.join(scratch, dir), { recursive: true });
  }
  const env = freshProfileEnv(process.env, scratch, endpoint);
  const children = [];
  let app;
  let browser;
  let page;
  let exit;
  let log;
  let launches = 0;
  let finished = false;
  let stopping;
  const qa = {
    scratch,
    executable,
    env,
    get page() {
      return page;
    },
    get pid() {
      return app?.pid;
    },
    async invoke(command, args = {}) {
      assert(!finished, "QA run already ended");
      return within(
        page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
          command,
          args,
        }),
        30000,
        `QA native command timed out: ${command}`,
      );
    },
    async start(args = []) {
      assert(!app, "Stop the owned child before restarting its profile");
      assert(!(await listening()), "QA port is already occupied");
      assert(!finished, "QA run already ended");
      log = fs.openSync(path.join(scratch, `app-${++launches}.log`), "w");
      app = spawn(executable, args, { env, stdio: ["ignore", log, log] });
      exit = new Promise((resolve, reject) => {
        app.once("exit", (code, signal) => resolve({ code, signal }));
        app.once("error", reject);
      });
      // Observe errors even if startup validation fails before stop awaits this promise.
      void exit.catch(() => {});
      children.push({ pid: app.pid, started: new Date().toISOString() });
      await waitFor(async () => {
        assert.equal(app.exitCode, null, "QA child exited before CDP was ready");
        return listening();
      }, "QA CDP not ready");
      browser = await chromium.connectOverCDP(endpoint);
      page = browser
        .contexts()[0]
        .pages()
        .find((p) => !p.url().startsWith("devtools"));
      assert(page, "QA application page missing");
      await page.getByTestId("header-settings").waitFor({ timeout: 30000 });
      assert.equal(normalize(await qa.invoke("detect_home")), normalize(scratch));
      const config = await qa.invoke("config_read");
      assert(
        normalize(config.path).startsWith(normalize(scratch) + "/"),
        "App data escaped QA profile",
      );
      return page;
    },
    async stop() {
      if (stopping) return stopping;
      if (!app) return;
      stopping = (async () => {
        // Disconnect errors must never skip cleanup of our exact child handle.
        await within(browser?.close(), 3000, "QA disconnect timed out").catch((error) =>
          console.error("QA CDP disconnect:", error.message),
        );
        browser = undefined;
        if (app.exitCode === null && app.signalCode === null) app.kill();
        try {
          children.at(-1).exit = await within(exit, 15000, "Owned QA child did not exit");
        } finally {
          fs.closeSync(log);
          app = undefined;
          page = undefined;
        }
        await waitFor(async () => !(await listening()), "Owned QA webview did not release port");
      })();
      try {
        await stopping;
      } finally {
        stopping = undefined;
      }
    },
  };
  try {
    const result = await within(run(qa), 180000, "QA acceptance exceeded three minutes");
    fs.writeFileSync(path.join(scratch, "acceptance.json"), JSON.stringify(result, null, 2));
    console.log("PASS", name, JSON.stringify(result));
  } catch (error) {
    finished = true;
    await within(
      page?.screenshot({ path: path.join(scratch, "failure.png"), timeout: 3000 }),
      3500,
      "QA capture timed out",
    ).catch(() => {});
    throw error;
  } finally {
    finished = true;
    try {
      await qa.stop();
    } finally {
      fs.writeFileSync(
        path.join(scratch, "processes.json"),
        JSON.stringify({ executable, children }, null, 2),
      );
      console.log("QA artifacts:", scratch);
    }
  }
}
