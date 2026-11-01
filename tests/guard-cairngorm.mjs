#!/usr/bin/env node
// Runs a test command and fails it if any running Cairngorm app (the one hosting the user's
// terminals, and possibly the agent running the tests) disappeared or restarted meanwhile.
// It detects damage after the fact; it cannot prevent it.
//   node tests/guard-cairngorm.mjs [--receipt logs/e2e/guard.json] -- <command> [args...]
// e.g. -- node node_modules/@playwright/test/cli.js test -c tests/playwright.config.ts
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Running Cairngorm processes as `{ id, start }`; `start` tells a restart from the same PID. */
export function snapshot() {
  if (process.platform === "win32") {
    const script =
      "$p = @(Get-Process cairngorm -ErrorAction SilentlyContinue | ForEach-Object { @{ id = $_.Id; start = $_.StartTime.Ticks.ToString() } }); ConvertTo-Json -InputObject $p -Compress";
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
      },
    );
    return JSON.parse(out || "[]");
  }
  const out = spawnSync("ps", ["-eo", "pid=,lstart=,comm="], { encoding: "utf8" }).stdout ?? "";
  return out
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.+?)\s+(\S+)$/))
    .filter((m) => m && /^cairngorm$/i.test(path.basename(m[3])))
    .map((m) => ({ id: Number(m[1]), start: m[2] }));
}

/** Processes from `before` that are gone or were replaced in `after`. */
export function missing(before, after) {
  return before.filter((b) => !after.some((a) => a.id === b.id && a.start === b.start));
}

/** Mocked browser runs must not inherit the host terminal's test observer or native opt-in. */
export function isolatedBrowserEnv(env) {
  const isolated = { ...env };
  const excluded = new Set([
    "NODE_OPTIONS",
    "CAIRNGORM_TEST_ENDPOINT",
    "CAIRNGORM_TEST_TOKEN",
    "CAIRNGORM_TEST_BINARY",
    "CAIRNGORM_NATIVE_PLUGIN_CHECK",
    "E2E_REAL",
    "CAIRNGORM_RESTORE_EXE",
    "CAIRNGORM_PLUGIN_ISOLATION",
  ]);
  for (const key of Object.keys(isolated)) {
    if (excluded.has(key.toUpperCase())) {
      delete isolated[key];
    }
  }
  return isolated;
}

function main(argv) {
  const split = argv.indexOf("--");
  const options = split < 0 ? [] : argv.slice(0, split);
  const command = split < 0 ? argv : argv.slice(split + 1);
  if (command.length === 0) {
    console.error(
      "usage: node tests/guard-cairngorm.mjs [--isolated-browser] [--receipt <file>] -- <command> [args...]",
    );
    return 2;
  }
  const receiptAt = options.indexOf("--receipt");
  const receipt = receiptAt >= 0 ? options[receiptAt + 1] : "logs/e2e/cairngorm-guard.json";
  const before = snapshot();
  // No shell: arguments reach the command unchanged. Run Node CLIs through `node <script>`.
  const program = command[0] === "node" ? process.execPath : command[0];
  const result = spawnSync(program, command.slice(1), {
    stdio: "inherit",
    env: options.includes("--isolated-browser") ? isolatedBrowserEnv(process.env) : process.env,
  });
  const after = snapshot();
  const gone = missing(before, after);
  mkdirSync(path.dirname(receipt), { recursive: true });
  writeFileSync(
    receipt,
    JSON.stringify({ command, exitCode: result.status, before, after, missing: gone }, null, 2),
  );
  if (gone.length > 0) {
    console.error(
      `[guard] Cairngorm ${gone.map((p) => p.id).join(", ")} disappeared or restarted during the run. ` +
        "Do not run another suite until the cause is known. Receipt: " +
        receipt,
    );
    return 3;
  }
  console.log(
    `[guard] Cairngorm ${before.map((p) => p.id).join(", ") || "(none running)"} unchanged.`,
  );
  return result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
