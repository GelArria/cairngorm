import type { ResultStatus, TestSignal } from "./types";

/** Commands are trusted only when received as an actual agent tool invocation. */
export function testCommand(command: string): string | undefined {
  const boundary = String.raw`(?:^|&&|\|\||;)\s*(?:[\w]+=[^\s]+\s+)*`;
  const executor = String.raw`(?:(?:npx(?:\s+--yes)?|npm\s+exec|pnpm\s+exec|yarn\s+exec|bunx|bun\s+x)\s+)?`;
  const patterns: [RegExp, string][] = [
    [new RegExp(boundary + executor + String.raw`vitest(?:\s|$)`), "Vitest"],
    [new RegExp(boundary + executor + String.raw`playwright\s+test\b`), "Playwright"],
    [new RegExp(boundary + executor + String.raw`jest(?:\s|$)`), "Jest"],
    [
      new RegExp(
        boundary + String.raw`(?:(?:python[\d.]*|py)\s+-m\s+)?(?:pytest|py\.test)(?:\s|$)`,
      ),
      "pytest",
    ],
    [new RegExp(boundary + String.raw`cargo\s+(?:nextest\s+run|test)\b`), "Cargo"],
    [new RegExp(boundary + String.raw`go\s+test\b`), "Go"],
    [new RegExp(boundary + String.raw`bun\s+test\b`), "Bun"],
    [new RegExp(boundary + String.raw`node\s+(?:--[\w=-]+\s+)*--test(?:\s|$)`), "Node"],
    [
      new RegExp(boundary + String.raw`(?:npm|pnpm|yarn)\s+(?:run\s+)?test(?::[\w-]+)?(?:\s|$)`),
      "Tests",
    ],
  ];
  return patterns.find(([re]) => re.test(command))?.[1];
}

function counts(line: string): Partial<Record<ResultStatus, number>> {
  const result: Partial<Record<ResultStatus, number>> = {};
  for (const [word, status] of [
    ["pass(?:ed)?", "passed"],
    ["fail(?:ed|ure|ures)?", "failed"],
    ["skip(?:ped)?|todo|ignored|deselected", "skipped"],
  ] as const) {
    const values = [...line.matchAll(new RegExp(`(\\d+)\\s+(?:${word})\\b`, "gi"))];
    if (values.length) {
      result[status] = values.reduce((n, m) => n + Number(m[1]), 0);
    }
  }
  return result;
}

export function testSignal(raw: string, runner?: string): TestSignal | undefined {
  const line = raw.trim().replace(/^[│┃]\s*/, "");
  const accepts = (name: string) => !runner || runner === "Tests" || runner === name;
  let m: RegExpMatchArray | null;
  if (runner === "Go" && /^.*[$>#]\s*go\s+test\b/.test(line)) {
    return { start: true, restart: true, runner: "Go" };
  }
  if (accepts("Vitest") && /^RERUN\s+/.test(line)) {
    return { start: true, restart: true, runner: "Vitest" };
  }
  if (/^(?:RUN|DEV)\s+v?\d[\w.-]*\s+\S/.test(line)) {
    return { start: true, runner: "Vitest" };
  }
  if ((m = line.match(/^Running (\d+) tests? using \d+ workers?/))) {
    return { start: true, runner: "Playwright", total: +m[1] };
  }
  if (/^=+\s*test session starts\s*=+/.test(line)) {
    return { start: true, runner: "pytest" };
  }
  if ((m = line.match(/^running (\d+) tests?$/))) {
    return { start: true, runner: "Cargo", total: +m[1] };
  }
  if (/^bun test v\d/.test(line)) {
    return { start: true, runner: "Bun" };
  }
  if (/^TAP version \d+/.test(line)) {
    return { start: true, runner: "Node" };
  }
  if (/^=== RUN\s+/.test(line)) {
    return { start: true, runner: "Go" };
  }
  if (/^RUNS\s+\S/.test(line)) {
    return { start: true, runner: "Jest" };
  }
  if (accepts("Cargo") && /^Finished\s+.*\btest\b.*target\(s\)/.test(line)) {
    return { start: true, restart: true, runner: "Cargo" };
  }
  if (accepts("Cargo") && (m = line.match(/^(?:Running\s+(.+?)\s+\(target|Doc-tests\s+(.+))/))) {
    return { runner: "Cargo", suite: m[1] ?? m[2] };
  }
  if (
    (accepts("Vitest") && /^Test Files\s/.test(line)) ||
    (accepts("Jest") && /^Test Suites:?\s/.test(line))
  ) {
    return { failed: /\d+ failed/.test(line) };
  }
  if ((accepts("Vitest") && /^Tests\s/.test(line)) || (accepts("Jest") && /^Tests:\s/.test(line))) {
    const c = counts(line);
    if (Object.keys(c).length) {
      return {
        counts: c,
        resetCounts: true,
        end: true,
        total: +(
          line
            .match(/\((\d+)\)|\b(\d+) total/)
            ?.slice(1)
            .find(Boolean) ?? Object.values(c).reduce((a, b) => a + b, 0)
        ),
      };
    }
  }
  if (accepts("Cargo") && /^test result: (?:ok|FAILED)\./.test(line)) {
    return { counts: counts(line), resetCounts: true, end: true, failed: line.includes("FAILED") };
  }
  if (
    accepts("pytest") &&
    /^=+.*\d+ (?:passed|failed|skipped|error).*\d.*(?:s|seconds)\s*=+$/.test(line)
  ) {
    return {
      counts: counts(line),
      resetCounts: true,
      end: true,
      failed: /\d+ (?:failed|errors?)/.test(line),
    };
  }
  if (/^(?:No (?:test files|tests) found|Error: No tests found)/.test(line)) {
    return { end: true, total: 0, failed: !/code 0/.test(line) };
  }
  if (accepts("pytest") && /^=+\s*(?:no tests ran|\d+ errors?) .*\s*=+$/.test(line)) {
    return { end: true, failed: true };
  }
  if (accepts("Playwright") && /^(?:\d+ (?:passed|failed|skipped)(?:\s|\(|$))/.test(line)) {
    return { counts: counts(line), end: true };
  }
  if (accepts("Bun") && (m = line.match(/^Ran (\d+) tests? across /))) {
    return { end: true, total: +m[1] };
  }
  if (accepts("Bun") && (m = line.match(/^(\d+) (pass|fail|skip)$/))) {
    return { counts: counts(line) };
  }
  if (accepts("Node") && (m = line.match(/^# (tests|pass|fail|skipped) (\d+)/))) {
    const key = { pass: "passed", fail: "failed", skipped: "skipped" }[m[1]] as
      | ResultStatus
      | undefined;
    return key ? { counts: { [key]: +m[2] } } : { total: +m[2] };
  }
  if (accepts("Node") && /^# duration_ms /.test(line)) {
    return { end: true };
  }
  if (
    accepts("Go") &&
    (m = line.match(
      /^(ok|FAIL|\?)\s+(\S+)\s+(?:[\d.]+s|\(cached\)|\[no test files\]|\[build failed\])/,
    ))
  ) {
    return {
      runner: "Go",
      package: m[2],
      end: true,
      result: {
        name: m[2],
        status: m[1] === "FAIL" ? "failed" : m[1] === "?" ? "skipped" : "passed",
      },
      failed: m[1] === "FAIL",
    };
  }
  if (accepts("Go") && line === "FAIL") {
    return { runner: "Go", end: true, failed: true };
  }
  if (accepts("Vitest") && /^PASS\s+Waiting for file changes/.test(line)) {
    return { end: true };
  }
  // Suite/test rows preserve their full label; redraws are deduplicated by the store.
  if (accepts("Jest") && (m = line.match(/^(PASS|FAIL)\s+(.+\.(?:[cm]?[jt]sx?|py))(?:\s|$)/))) {
    return {
      runner: "Jest",
      result: { name: m[2], status: m[1] === "PASS" ? "passed" : "failed" },
    };
  }
  if (accepts("Cargo") && (m = line.match(/^test (.+) \.{3} (ok|FAILED|ignored)/))) {
    return {
      result: {
        name: m[1],
        status: m[2] === "ok" ? "passed" : m[2] === "FAILED" ? "failed" : "skipped",
      },
    };
  }
  if (accepts("Go") && (m = line.match(/^--- (PASS|FAIL|SKIP): (.+?)(?: \([\d.]+s\))?$/))) {
    return {
      result: {
        name: m[2],
        status: m[1] === "PASS" ? "passed" : m[1] === "FAIL" ? "failed" : "skipped",
      },
    };
  }
  if (accepts("pytest") && (m = line.match(/^(.+::\S+)\s+(PASSED|FAILED|SKIPPED)/))) {
    return {
      result: {
        name: m[1],
        status: m[2] === "PASSED" ? "passed" : m[2] === "FAILED" ? "failed" : "skipped",
      },
    };
  }
  if (accepts("Bun") && (m = line.match(/^\((pass|fail|skip)\)\s+(.+)/))) {
    return {
      result: {
        name: m[2],
        status: m[1] === "pass" ? "passed" : m[1] === "fail" ? "failed" : "skipped",
      },
    };
  }
  if (accepts("Node") && (m = line.match(/^(ok|not ok)\s+\d+\s+(?:- )?(.+)/))) {
    return {
      result: {
        name: m[2],
        status: /# (?:SKIP|TODO)/.test(line) ? "skipped" : m[1] === "ok" ? "passed" : "failed",
      },
    };
  }
  if (
    (!runner || ["Tests", "Vitest", "Playwright", "Jest"].includes(runner)) &&
    (m = line.match(/^[✓✔√×✗✘-]\s+(?:\d+\s+)?(.+?)(?:\s+\([\d.]+\s*m?s\))?$/))
  ) {
    if (runner === "Vitest" && !/^\S+\.(?:[cm]?[jt]sx?)(?:\s|$)/.test(m[1])) {
      return;
    }
    return {
      result: {
        name: m[1],
        status: /^[×✗✘]/.test(line) ? "failed" : line.startsWith("-") ? "skipped" : "passed",
      },
    };
  }
}
