import type { BrowserActivity } from "../data/browser-activity";
import type { TestRun } from "./types";

const list = (values: string[]) => {
  const unique = [...new Set(values)];
  const shown = unique.slice(0, 4);
  return shown.join(", ") + (unique.length > 4 ? ` and ${unique.length - 4} more` : "");
};

/** Summarize observed work across all pages, without inventing successful steps. */
export function summarizeTestRun(run: TestRun, activities: BrowserActivity[]): string {
  const completed = activities.filter((a) => a.status === "completed");
  const failed = activities.filter((a) => a.status === "failed").length;
  const stopped = activities.filter(
    (a) => a.status === "interrupted" || a.status === "running",
  ).length;
  const sentences = [
    run.status === "interrupted"
      ? "Execution was interrupted."
      : run.status === "failed" || run.failed || failed
        ? "Execution finished with errors."
        : "Execution finished.",
  ];
  for (const [prefixes, verb] of [
    [["Navigate"], "Visited"],
    [["Click", "Double click", "Tap"], "Clicked"],
    [["Fill", "Type", "Clear"], "Updated fields"],
    [["Select option", "Check", "Uncheck"], "Changed selections"],
  ] as const) {
    const targets = completed
      .filter((a) => prefixes.some((prefix) => a.label.startsWith(`${prefix} · `)))
      .map((a) => a.label.slice(a.label.indexOf(" · ") + 3));
    if (targets.length) {
      sentences.push(`${verb} ${list(targets)}.`);
    }
  }
  const pages = new Set(activities.map((a) => a.pageId)).size;
  if (activities.length) {
    sentences.push(
      `${completed.length} recorded ${completed.length === 1 ? "step" : "steps"} completed across ${pages} browser ${pages === 1 ? "page" : "pages"}.`,
    );
  }
  if (failed) {
    sentences.push(`${failed} browser ${failed === 1 ? "action" : "actions"} failed.`);
  }
  if (stopped) {
    sentences.push(`${stopped} ${stopped === 1 ? "step" : "steps"} did not complete.`);
  }
  if (run.total != null || run.passed || run.failed || run.skipped) {
    sentences.push(`Tests: ${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped.`);
  } else if (!activities.length) {
    sentences.push(`${run.runner} finished without individual results.`);
  }
  if (run.endedAt != null) {
    sentences.push(`Duration: ${Math.max(0, (run.endedAt - run.startedAt) / 1000).toFixed(1)}s.`);
  }
  return sentences.join(" ");
}

export interface TestRunError {
  label: string;
  details?: string;
}
export function collectTestRunErrors(run: TestRun, activities: BrowserActivity[]): TestRunError[] {
  const errors: TestRunError[] = [
    ...run.results
      .filter((r) => r.status === "failed")
      .map((r) => ({ label: `Failed test · ${r.name}` })),
    ...activities
      .filter((a) => a.status === "failed")
      .map((a) => ({ label: `Failed action · ${a.label}` })),
  ];
  const diagnostic = /^(?:\w*Error\b|error\s*[:\[]|FAIL\b|panic\b|thread .+ panicked)/i;
  const result =
    /^(?:[✓✔✘×]|(?:Tests|Test Files|Test Suites)\b|\d+\s+(?:passed|failed|skipped)\b)/i;
  const seen = new Set<string>();
  for (let i = 0; i < run.output.length; i++) {
    const line = run.output[i].trim();
    if (!diagnostic.test(line) || seen.has(line)) {
      continue;
    }
    seen.add(line);
    const detail: string[] = [];
    for (let n = i + 1; n < Math.min(i + 7, run.output.length); n++) {
      const next = run.output[n].trim();
      if (!next || diagnostic.test(next) || result.test(next)) {
        break;
      }
      detail.push(run.output[n]);
    }
    errors.push({ label: line, ...(detail.length ? { details: detail.join("\n") } : {}) });
    if (seen.size >= 8) {
      break;
    }
  }
  if (!errors.length && (run.failed || run.status === "failed")) {
    errors.push({ label: "The runner reported a failure. See Output for details." });
  }
  return errors;
}
