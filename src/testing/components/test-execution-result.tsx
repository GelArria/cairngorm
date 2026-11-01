import { Icon } from "@/common/ui/icon";
import { useBrowserActivities } from "@/testing/hooks/use-browser-activities";
import { summarizeTestRun } from "../model/test-run-report";
import type { TestRun } from "../model/types";

const labels = {
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  completed: "Finished",
  interrupted: "Interrupted",
};

/** Runner summaries and startup failures are execution results, not invented test cases. */
export function TestExecutionResult({ run }: { run: TestRun }) {
  const activities = useBrowserActivities(run.sessionId);
  return (
    <section
      data-testid="test-execution-result"
      aria-label="Execution result"
      aria-live="polite"
      class={`flex items-start gap-3 border-b border-border/60 px-4 py-4 text-xs leading-5 ${run.status === "failed" ? "bg-destructive/5" : "bg-card/40"}`}
    >
      <Icon
        name={
          run.status === "running"
            ? "spinner"
            : run.status === "failed"
              ? "warning-circle"
              : run.status === "passed"
                ? "check-circle"
                : "minus"
        }
        class={`mt-0.5 text-lg ${run.status === "running" ? "text-muted-foreground motion-safe:animate-spin" : run.status === "failed" ? "text-destructive" : run.status === "passed" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
      />
      <div class="min-w-0 flex-1">
        <h3 class="font-medium text-foreground">
          {run.runner} execution · {labels[run.status]}
        </h3>
        {run.command && (
          <p class="mt-1 break-words font-mono text-[11px] text-muted-foreground">{run.command}</p>
        )}
        <p class="mt-1 text-muted-foreground">
          {run.status === "running"
            ? "Execution is running. Results appear as the runner reports them."
            : summarizeTestRun(run, activities)}
        </p>
        {!run.results.length && (
          <>
            <p class="mt-1 text-muted-foreground">
              {run.status === "running"
                ? "Waiting for individual test results."
                : run.total === 0
                  ? "No tests were reported."
                  : run.passed || run.failed || run.skipped
                    ? "The runner reported aggregate counts, not individual test names."
                    : "No individual test results were reported; this is the execution status."}
            </p>
            {!!run.output.length && (
              <pre class="mt-3 rounded-md border border-border/60 bg-background/70 p-3 whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/90">
                {run.output.slice(-8).join("\n")}
              </pre>
            )}
          </>
        )}
      </div>
    </section>
  );
}
