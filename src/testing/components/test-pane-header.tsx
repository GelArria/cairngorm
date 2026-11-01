import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import type { TestRun } from "../model/types";

export function TestPaneHeader({
  run,
  now,
  sourceTitle,
  onShowTerminal,
}: {
  run?: TestRun;
  now: number;
  sourceTitle: string;
  onShowTerminal: () => void;
}) {
  const elapsed = run
    ? Math.max(0, ((run.endedAt ?? now) - run.startedAt) / 1000).toFixed(1)
    : "0.0";
  const status = !run
    ? "Waiting"
    : run.status === "running"
      ? "Running"
      : run.status === "completed"
        ? "Finished"
        : run.status === "interrupted"
          ? "Interrupted"
          : run.status === "failed"
            ? "Failed"
            : "Passed";
  const done = run ? run.passed + run.failed + run.skipped : 0;
  return (
    <header class="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 bg-card px-3 py-2">
      <div class="flex min-w-0 items-center gap-2" title={run?.command ?? sourceTitle}>
        <h2 class="truncate text-sm font-semibold">{run?.runner ?? "Test browser"}</h2>
        <span
          class={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${run?.status === "failed" ? "bg-destructive/10 text-destructive" : run?.status === "passed" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-foreground"}`}
        >
          <Icon
            name={
              run?.status === "running"
                ? "spinner"
                : run?.status === "passed"
                  ? "check-circle"
                  : run?.status === "failed"
                    ? "warning-circle"
                    : "minus"
            }
            class={run?.status === "running" ? "text-xs motion-safe:animate-spin" : "text-xs"}
          />
          {status}
        </span>
        {run && (
          <span class="font-mono text-[11px] tabular-nums text-muted-foreground">{elapsed}s</span>
        )}
        <span class="sr-only">{run?.command ?? sourceTitle}</span>
      </div>
      <div class="ml-auto flex min-w-0 items-center gap-3">
        {run && (
          <div
            class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span
              class={`flex items-center gap-1 ${run.passed ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
              data-testid="test-passed"
              title={`${run.passed} passed`}
            >
              <Icon name="check" />
              {run.passed}
              <span class="sr-only"> passed</span>
            </span>
            <span
              class={`flex items-center gap-1 ${run.failed ? "text-destructive" : "text-muted-foreground"}`}
              data-testid="test-failed"
              title={`${run.failed} failed`}
            >
              <Icon name="x" />
              {run.failed}
              <span class="sr-only"> failed</span>
            </span>
            <span
              class="flex items-center gap-1 text-muted-foreground"
              title={`${run.skipped} skipped`}
            >
              <Icon name="minus" />
              {run.skipped}
              <span class="sr-only"> skipped</span>
            </span>
            <span class="whitespace-nowrap border-l border-border pl-3 text-[11px] text-muted-foreground">
              {run.total != null
                ? `${done} / ${run.total} tests`
                : `${run.results.length} observed results`}
            </span>
          </div>
        )}
        <Tooltip content="Return to terminal" side="bottom">
          <Button variant="subtle" size="icon-sm" aria-label="Terminal" onClick={onShowTerminal}>
            <Icon name="terminal" class="text-xs" />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
