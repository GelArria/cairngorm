import { describe, expect, it } from "vitest";
import { TerminalLines } from "../../src/testing/model/terminal-lines";
import { TestTracker } from "../../src/testing/model/test-tracker";
import { testCommand } from "../../src/testing/model/test-signals";
import type { TestRun } from "../../src/testing/model/types";

function observe() {
  let run: TestRun | undefined;
  let starts = 0;
  const tracker = new TestTracker("pty-1", (next, start) => {
    run = next;
    if (start) starts++;
  });
  const lines = new TerminalLines((line, redraw) => tracker.line(line, redraw));
  return { tracker, lines, run: () => run, starts: () => starts };
}

describe("test output detection", () => {
  it("parses fragmented UTF-8 and ANSI from a TUI without duplicate rows", () => {
    const o = observe();
    const bytes = new TextEncoder().encode(
      "\x1b[32m RUN v3.0.0 C:/app\x1b[0m\r\n ✓ tests/utf8-λ.test.ts (2 tests) 12ms\r\n",
    );
    for (const byte of bytes) o.lines.push(Uint8Array.of(byte));
    o.lines.text(
      "\x1b[H RUN v3.0.0 C:/app\n ✓ tests/utf8-λ.test.ts (2 tests) 12ms\n Tests 2 passed (2)\n",
    );
    expect(o.starts()).toBe(1);
    expect(o.run()).toMatchObject({ runner: "Vitest", status: "passed", passed: 2, total: 2 });
    expect(o.run()?.results).toHaveLength(1);
    expect(o.run()?.results[0].name).toContain("utf8-λ");
    expect(o.run()?.output.join("\n")).not.toContain("\x1b");
  });

  it.each([
    [
      "Running 3 tests using 1 worker\n ✓ 1 [chromium] › login.spec.ts:2 › signs in (1s)\n ✘ 2 [chromium] › login.spec.ts:8 › rejects password (1s)\n 1 failed\n 2 passed (3s)\n",
      "Playwright",
      "failed",
      2,
      1,
    ],
    [" RUNS login.test.ts\nPASS login.test.ts\nTests: 3 passed, 3 total\n", "Jest", "passed", 3, 0],
    [
      "==== test session starts ====\ntests/test_auth.py::test_login PASSED [50%]\ntests/test_auth.py::test_bad FAILED [100%]\n==== 1 failed, 1 passed in 0.3s ====\n",
      "pytest",
      "failed",
      1,
      1,
    ],
    [
      "running 2 tests\ntest tests::login ... ok\ntest tests::bad ... FAILED\ntest result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.1s\n",
      "Cargo",
      "failed",
      1,
      1,
    ],
    [
      "bun test v1.3.0 (aabb)\n(pass) login [1ms]\n2 pass\n0 fail\nRan 2 tests across 1 file. [2ms]\n",
      "Bun",
      "passed",
      2,
      0,
    ],
    ["=== RUN   TestLogin\n--- PASS: TestLogin (0.00s)\nok app/auth 0.01s\n", "Go", "passed", 1, 0],
    [
      "TAP version 13\nok 1 - login\nnot ok 2 - password\n# tests 2\n# pass 1\n# fail 1\n# duration_ms 20\n",
      "Node",
      "failed",
      1,
      1,
    ],
  ])("detects %s", (output, runner, status, passed, failed) => {
    const o = observe();
    o.lines.text(output);
    expect(o.run()).toMatchObject({ runner, status, passed, failed });
  });

  it("does not open tests for prose, suggested commands, or ordinary build output", () => {
    const o = observe();
    o.lines.text(
      "We should run npx vitest run next.\n$ npx playwright test\n✓ built in 20ms\nTests are important\n",
    );
    expect(o.starts()).toBe(0);
  });

  it("starts a fresh watch run, and reports interruption without inventing success", () => {
    const o = observe();
    o.lines.text(" RUN v3.0.0 /app\nTests 1 failed (1)\n RUN v3.0.0 /app\n");
    o.tracker.finish("interrupted");
    expect(o.starts()).toBe(2);
    expect(o.run()).toMatchObject({ id: 2, status: "interrupted", failed: 0 });
  });

  it("keeps logs and result memory bounded", () => {
    const o = observe();
    o.tracker.start("Tests");
    for (let i = 0; i < 2000; i++) o.lines.text(`✓ case ${i}\n`);
    expect(o.run()?.output).toHaveLength(600);
    expect(o.run()?.results).toHaveLength(500);
  });

  it("ignores other runner syntax inside a successful verbose Vitest test label", () => {
    const o = observe();
    o.lines.text(
      " RUN v4.0.0 /repo\n ✓ tests/fixtures.test.ts > handles fake Playwright output\n ✘ 2 [chromium] › fake.spec.ts > fake failure (1s)\n 1 failed\n Tests: 3 passed, 3 total\n test result: FAILED. 1 passed; 1 failed;\n ==== 1 failed in 0.1s ====\n ok app/auth 0.01s\n ✓ tests/real.test.ts > passes\n Tests 2 passed (2)\n",
    );
    expect(o.run()).toMatchObject({ status: "passed", passed: 2, failed: 0 });
    expect(o.run()?.results).toHaveLength(2);
    expect(
      o
        .run()
        ?.results.map((row) => row.name)
        .join("\n"),
    ).not.toContain("[chromium]");
  });

  it("recognizes Vitest RERUN and clears the previous failure and rows", () => {
    const o = observe();
    o.lines.text(
      " DEV v4.0.0 /repo\n × auth.test.ts > fails\n Tests 1 failed (1)\n RERUN auth.test.ts x1\n ✓ auth.test.ts > passes\n Tests 1 passed (1)\n",
    );
    expect(o.run()).toMatchObject({ id: 2, status: "passed", passed: 1, failed: 0 });
    expect(o.run()?.results).toEqual([{ name: "auth.test.ts > passes", status: "passed" }]);
  });

  it("does not start another execution when pi repaints completed output", () => {
    const o = observe();
    const text = " RUN v4.0.0 /repo\n Tests 1 passed (1)\n";
    o.lines.push(new TextEncoder().encode(text));
    o.lines.push(new TextEncoder().encode("\x1b[?2026h\x1b[2J\x1b[H" + text + "\x1b[?2026l"));
    expect(o.starts()).toBe(1);
    o.lines.push(new TextEncoder().encode(text));
    expect(o.starts()).toBe(2);
  });

  it("detects first runs and fresh reruns inside synchronized TUI frames", () => {
    const o = observe();
    const frame = (text: string) =>
      o.lines.push(new TextEncoder().encode(`\x1b[?2026h\x1b[2J\x1b[H${text}\x1b[?2026l`));
    frame(" DEV v4.0.0 /repo\n Tests 1 failed (1)\n");
    expect(o.starts()).toBe(1);
    frame(" RERUN auth.test.ts x1\n ✓ auth.test.ts > passes\n Tests 1 passed (1)\n");
    expect(o.run()).toMatchObject({ id: 2, status: "passed" });
    frame(" RERUN auth.test.ts x1\n ✓ auth.test.ts > passes\n Tests 1 passed (1)\n");
    expect(o.starts()).toBe(2);
  });

  it("preserves completed results when the terminal exits", () => {
    const o = observe();
    o.lines.text(" RUN v4.0.0 /repo\n Tests 2 passed (2)\n");
    o.tracker.finish("interrupted");
    expect(o.run()).toMatchObject({ status: "passed", passed: 2 });
  });

  it("accepts a visibly new execution inside a full-screen repaint", () => {
    const o = observe();
    o.lines.text("Running 3 tests using 1 worker\n3 passed (1s)\n");
    o.lines.push(
      new TextEncoder().encode(
        "\x1b[?2026h\x1b[2J\x1b[HRunning 1 test using 1 worker\n1 failed\n\x1b[?2026l",
      ),
    );
    expect(o.starts()).toBe(2);
    expect(o.run()).toMatchObject({ status: "failed", total: 1, passed: 0, failed: 1 });
  });

  it("aggregates Cargo unit and doc-test suites, including zero doc-tests", () => {
    const o = observe();
    o.lines.text(
      "Finished `test` profile [unoptimized] target(s) in 0.1s\nRunning unittests src/lib.rs (target/debug/deps/lib)\nrunning 2 tests\ntest auth ... ok\ntest logout ... ok\ntest result: ok. 2 passed; 0 failed; 0 ignored;\nDoc-tests app\nrunning 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;\n",
    );
    expect(o.starts()).toBe(1);
    expect(o.run()).toMatchObject({ passed: 2, failed: 0, total: 2, status: "passed" });
    expect(o.run()?.results).toHaveLength(2);
  });

  it("opens and aggregates default Go package summaries and cached results", () => {
    const o = observe();
    o.lines.text("ok\tapp/auth\t0.012s\nok\tapp/config\t(cached)\nFAIL\tapp/db\t0.123s\nFAIL\n");
    expect(o.starts()).toBe(1);
    expect(o.run()).toMatchObject({ runner: "Go", passed: 2, failed: 1, status: "failed" });
  });

  it("keeps verbose Go results across packages, including identical test names", () => {
    const o = observe();
    o.lines.text(
      "=== RUN TestShared\n--- PASS: TestShared (0.00s)\nok app/auth 0.012s\n=== RUN TestShared\n--- PASS: TestShared (0.00s)\nok app/config 0.010s\n",
    );
    expect(o.starts()).toBe(1);
    expect(o.run()).toMatchObject({ passed: 2, status: "passed" });
    expect(o.run()?.results.map((r) => r.name)).toContain("app/auth › TestShared");
    expect(o.run()?.results.map((r) => r.name)).toContain("app/config › TestShared");
  });
});

it("recognizes test commands only for actual shell tool arguments", () => {
  for (const command of [
    "npx vitest run",
    "npm run test:unit",
    "bun test",
    "python -m pytest -q",
    "cargo test",
    "go test ./...",
  ])
    expect(testCommand(command)).toBeTruthy();
  for (const command of [
    "npm run build",
    "echo 'vitest run'",
    "rg vitest src",
    "cat tests/vitest.ts",
    "git diff -- vitest.ts",
    "node -e 'vitest run'",
    "ls tests/pytest.py",
  ])
    expect(testCommand(command)).toBeUndefined();
});
