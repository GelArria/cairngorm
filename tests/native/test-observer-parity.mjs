// node tests/native/test-observer-parity.mjs — production Rust vs retained tool parser.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const texts = [
  " RUN v4.0.0 /repo\n ✓ utf8-λ.test.ts > passes\n Tests 2 passed (2)\n",
  "Running 3 tests using 1 worker\n ✓ 1 signs in (1s)\n ✘ 2 rejects (1s)\n 1 failed\n 2 passed (3s)\n",
  " RUNS login.test.ts\nPASS login.test.ts\nTests: 3 passed, 3 total\n",
  "==== test session starts ====\ntests/test_auth.py::login PASSED [50%]\ntests/test_auth.py::bad FAILED [100%]\n==== 1 failed, 1 passed in 0.3s ====\n",
  "running 2 tests\ntest login ... ok\ntest bad ... FAILED\ntest result: FAILED. 1 passed; 1 failed; 0 ignored;\n",
  "bun test v1.3.0\n(pass) login [1ms]\n2 pass\n0 fail\nRan 2 tests across 1 file. [2ms]\n",
  "=== RUN TestShared\n--- PASS: TestShared (0.00s)\nok app/auth 0.012s\n=== RUN TestShared\n--- PASS: TestShared (0.00s)\nok app/config 0.010s\n",
  "ok\tapp/auth\t0.012s\nok\tapp/config\t(cached)\nFAIL\tapp/db\t0.123s\nFAIL\n",
  "TAP version 13\nok 1 - login\nnot ok 2 - password\n# tests 2\n# pass 1\n# fail 1\n# duration_ms 20\n",
  "Finished `test` profile target(s) in 0.1s\nRunning unittests src/lib.rs (target/debug/deps/lib)\nrunning 2 tests\ntest auth ... ok\ntest logout ... ok\ntest result: ok. 2 passed; 0 failed; 0 ignored;\nDoc-tests app\nrunning 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;\n",
  "We should run npx vitest next.\n$ npx playwright test\n✓ built in 20ms\n",
  " DEV v4.0.0 /repo\n × auth.test.ts > fails\n Tests 1 failed (1)\n RERUN auth.test.ts x1\n ✓ auth.test.ts > passes\n Tests 1 passed (1)\n",
  " RUN v4.0.0 /repo\n Tests 1 passed (1)\n\x1b[?2026h\x1b[2J\x1b[H RUN v4.0.0 /repo\n Tests 1 passed (1)\n\x1b[?2026l",
  "\x1b[?2026h\x1b[2J\x1b[H DEV v4.0.0 /repo\n Tests 1 failed (1)\n\x1b[?2026l\x1b[?2026h\x1b[2J\x1b[H RERUN auth.test.ts x1\n Tests 1 passed (1)\n\x1b[?2026l",
  " RUN v4.0.0 /repo\n test result: FAILED. 1 passed; 1 failed;\n ok app/auth 0.01s\n ✓ real.test.ts > passes\n Tests 1 passed (1)\n",
  "Running 2000 tests using 1 worker\n" +
    Array.from({ length: 2000 }, (_, i) => `✓ case ${i}\n`).join(""),
  "\x1b]0;title\x07\x1b[32m RUN v4.0.0 /repo\x1b[0m\r\n ✓ utf8-λ🦀.test.ts > passes\r\n Tests 1 passed (1)\n",
  "Running 1 test using 1 worker\n ✓ partial",
  "Running 1 test using 1 worker\nNo tests found, exiting with code 0\n",
];
const corpus = texts.flatMap((text) => [1, 7, 4096].map((size) => ({ text, size })));
const input = path.resolve("logs/optimization-parser-input.json");
const output = path.resolve("logs/optimization-parser-output.json");
fs.mkdirSync("logs", { recursive: true });
fs.writeFileSync(input, JSON.stringify(corpus));
execFileSync(
  "cargo",
  [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "export_parser_parity",
    "--",
    "--ignored",
  ],
  {
    env: { ...process.env, TEST_OBSERVER_INPUT: input, TEST_OBSERVER_OUTPUT: output },
    stdio: "inherit",
  },
);
const actual = JSON.parse(fs.readFileSync(output, "utf8"));
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const normalize = (run) => {
  if (!run) return null;
  const { startedAt, endedAt, command, ...rest } = run;
  return JSON.parse(JSON.stringify(rest));
};
try {
  const { TestTracker } = await server.ssrLoadModule("/src/testing/model/test-tracker.ts");
  const { TerminalLines } = await server.ssrLoadModule("/src/testing/model/terminal-lines.ts");
  for (const [i, { text, size }] of corpus.entries()) {
    let expected;
    const tracker = new TestTracker("parity", (run) => {
      expected = run;
    });
    const lines = new TerminalLines((line, redraw) => tracker.line(line, redraw));
    const bytes = new TextEncoder().encode(text);
    for (let pos = 0; pos < bytes.length; pos += size) lines.push(bytes.slice(pos, pos + size));
    lines.flush();
    tracker.finish("interrupted");
    assert.deepEqual(normalize(actual[i]), normalize(expected), `case ${i}, chunk=${size}`);
  }
  console.log(
    `PASS: ${corpus.length} differential cases; all 8 runners, fragmentation, redraws, watch, EOF and bounds`,
  );
} finally {
  await server.close();
}
