import { describe, expect, it } from "vitest";
import { collectTestRunErrors, summarizeTestRun } from "../../src/testing/model/test-run-report";
import type { BrowserActivity } from "../../src/testing/data/browser-activity";
import type { TestRun } from "../../src/testing/model/types";

const run = (changes: Partial<TestRun> = {}): TestRun => ({
  id: 1,
  sessionId: "test",
  runner: "Playwright",
  status: "passed",
  startedAt: 1000,
  endedAt: 3500,
  passed: 1,
  failed: 0,
  skipped: 0,
  results: [],
  output: [],
  ...changes,
});
const action = (
  label: string,
  status: BrowserActivity["status"] = "completed",
  pageId = "page",
): BrowserActivity => ({
  type: "activity",
  activityId: label,
  pageId,
  label,
  status,
  startedAt: 1100,
  timestamp: 1200,
});

describe("observed walkthrough summary", () => {
  it("groups completed actions across pages and deduplicates targets", () => {
    const summary = summarizeTestRun(run(), [
      action("Navigate · https://shop.test/"),
      action("Click · Checkout"),
      action("Click · Checkout"),
      action("Fill · Email", "completed", "other"),
      action("Check · Terms"),
    ]);
    expect(summary).toContain("Visited https://shop.test/.");
    expect(summary).toContain("Clicked Checkout.");
    expect(summary).toContain("Updated fields Email.");
    expect(summary).toContain("Changed selections Terms.");
    expect(summary).toContain("5 recorded steps completed across 2 browser pages.");
    expect(summary).toContain("Tests: 1 passed, 0 failed, 0 skipped.");
    expect(summary).toContain("Duration: 2.5s.");
  });

  it("does not describe failed, running or interrupted actions as performed work", () => {
    const summary = summarizeTestRun(run({ status: "interrupted", passed: 0 }), [
      action("Click · Paid", "failed"),
      action("Fill · Password", "interrupted"),
      action("Navigate · Next", "running"),
    ]);
    expect(summary).toContain("Execution was interrupted.");
    expect(summary).toContain("1 browser action failed.");
    expect(summary).toContain("2 steps did not complete.");
    expect(summary).not.toMatch(/Clicked|Updated fields|Visited|Paid|Password|Next/);
  });

  it("keeps summaries concise when a run updates many distinct targets", () => {
    const summary = summarizeTestRun(
      run({ status: "failed", failed: 1 }),
      Array.from({ length: 8 }, (_, i) => action(`Fill · Field ${i}`)),
    );
    expect(summary).toContain("Execution finished with errors.");
    expect(summary).toContain("Updated fields Field 0, Field 1, Field 2, Field 3 and 4 more.");
    expect(summary).not.toContain("Field 4");
  });

  it("describes a run without browser actions or individual results accurately", () => {
    const summary = summarizeTestRun(run({ status: "completed", passed: 0 }), []);
    expect(summary).toContain("Playwright finished without individual results.");
    expect(summary).not.toContain("Visited");
    expect(summary).not.toContain("Tests:");
  });
});

describe("bottom-panel errors", () => {
  it("includes failed tests, browser actions and deduplicated diagnostic output", () => {
    const errors = collectTestRunErrors(
      run({
        status: "failed",
        failed: 1,
        results: [{ name: "Checkout", status: "failed" }],
        output: [
          "TypeError: checkout is unavailable",
          "  at checkout.ts:12",
          "",
          "TypeError: checkout is unavailable",
        ],
      }),
      [action("Click · Place order", "failed")],
    );
    expect(errors).toEqual([
      { label: "Failed test · Checkout" },
      { label: "Failed action · Click · Place order" },
      { label: "TypeError: checkout is unavailable", details: "  at checkout.ts:12" },
    ]);
  });

  it("shows a failure fallback and keeps successful runs free of errors", () => {
    expect(collectTestRunErrors(run({ status: "failed" }), [])).toEqual([
      { label: "The runner reported a failure. See Output for details." },
    ]);
    expect(collectTestRunErrors(run(), [action("Click · Checkout")])).toEqual([]);
  });

  it("bounds extracted output errors and diagnostic lines", () => {
    const output = Array.from({ length: 12 }, (_, i) => [
      `Error: failure ${i}`,
      ...Array.from({ length: 9 }, () => "  trace"),
      "",
    ]).flat();
    const errors = collectTestRunErrors(run({ output }), []);
    expect(errors).toHaveLength(8);
    expect(errors[0].details?.split("\n")).toHaveLength(6);
  });

  it("keeps later test results and summaries out of error details", () => {
    const errors = collectTestRunErrors(
      run({ output: ["Error: timeout", "  at checkout.ts:12", "✘ 1 checkout failed", "1 failed"] }),
      [],
    );
    expect(errors).toEqual([{ label: "Error: timeout", details: "  at checkout.ts:12" }]);
  });
});
