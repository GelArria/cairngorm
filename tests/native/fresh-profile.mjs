// Windows-only native flow. Build with tests/tauri.fresh-profile.json before running.
// Only the child started here is ever closed; the installed app stays untouched.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { freshProfileEnv } from "./fresh-profile-env.mjs";

assert.equal(process.platform, "win32");
const executable = path.resolve("src-tauri/target/debug/cairngorm.exe");
assert(
  fs.readFileSync(executable).includes(Buffer.from("dev.cairngorm.fresh-profile")),
  "Build the QA identifier first; refusing to launch an installed-profile binary",
);
const scratch = path.resolve(`logs/e2e/native-fresh-${Date.now()}`);
const endpoint = "http://127.0.0.1:9337";
assert(
  !(await fetch(`${endpoint}/json/version`).then(
    () => true,
    () => false,
  )),
  "QA port is occupied",
);
for (const dir of ["AppData/Roaming", "AppData/Local", ".pi/agent", ".claude", ".codex"]) {
  fs.mkdirSync(path.join(scratch, dir), { recursive: true });
}
const env = freshProfileEnv(process.env, scratch, endpoint);
const log = fs.openSync(path.join(scratch, "app.log"), "w");
const app = spawn(executable, [], { env, stdio: ["ignore", log, log] });
const exited = new Promise((resolve) =>
  app.once("exit", (code, signal) => resolve({ code, signal })),
);
try {
  const deadline = Date.now() + 30000;
  while (
    !(await fetch(`${endpoint}/json/version`).then(
      (r) => r.ok,
      () => false,
    ))
  ) {
    assert.equal(app.exitCode, null, "Sandbox exited before CDP was ready");
    assert(Date.now() < deadline, "Sandbox CDP was not ready; inspect app.log");
    await delay(100);
  }
  const runner = spawn(
    process.execPath,
    ["node_modules/e2e/dist/cli/bin.js", "run", "--config", "e2e.native-fresh.config.ts"],
    { env, stdio: "inherit" },
  );
  const status = await new Promise((resolve, reject) => {
    runner.once("error", reject);
    runner.once("exit", resolve);
  });
  assert.equal(app.exitCode, null, "Sandbox closed during the test");
  process.exitCode = status ?? 1;
} finally {
  // This is the exact child handle, never a process-name kill or the installed app.
  if (app.exitCode === null) app.kill();
  const exit = await exited;
  fs.writeFileSync(
    path.join(scratch, "run.json"),
    JSON.stringify(
      { pid: app.pid, executable, scratch, exit, testExitCode: process.exitCode ?? 0 },
      null,
      2,
    ),
  );
  fs.closeSync(log);
  console.log(`Native scratch: ${scratch}`);
}
