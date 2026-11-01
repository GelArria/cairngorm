import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { ScrollArea } from "@/common/ui/scroll-area";
import { useBrowserActivities } from "@/testing/hooks/use-browser-activities";
import { useEffect, useState } from "preact/hooks";
import { collectTestRunErrors, summarizeTestRun } from "../model/test-run-report";
import type { TestRun } from "../model/types";

export function TestRunReportPanel({
  run,
  onShowOutput,
}: {
  run: TestRun;
  onShowOutput: () => void;
}) {
  const activities = useBrowserActivities(run.sessionId);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const compact = window.matchMedia("(max-height: 480px)");
    const adapt = () => setExpanded(!compact.matches);
    adapt();
    compact.addEventListener("change", adapt);
    return () => compact.removeEventListener("change", adapt);
  }, []);
  const finished = run.status !== "running" && !activities.some((a) => a.status === "running");
  const errors = collectTestRunErrors(run, activities);
  if (!finished && !errors.length) {
    return null;
  }
  return (
    <section
      class={`flex max-h-[min(14rem,28vh)] min-h-0 shrink-0 flex-col border-t border-border/70 ${errors.length ? "bg-destructive/5" : "bg-card/60"}`}
      aria-label="Test run report"
      data-testid="test-run-report"
    >
      <div class="flex min-w-0 shrink-0 items-center gap-3 px-4 py-1.5">
        <Button
          variant="ghost"
          size="xs"
          class="min-w-0 flex-1 justify-start gap-2 px-0"
          aria-expanded={expanded}
          aria-controls={`test-report-${run.sessionId}`}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon
            name={errors.length ? "warning-circle" : "file-text"}
            class={`text-xs ${errors.length ? "text-destructive" : "text-muted-foreground"}`}
          />
          <span class="shrink-0">{finished ? "Run summary" : "Errors"}</span>
          <span class="truncate font-normal text-muted-foreground">
            {errors.length
              ? `${errors.length} reported ${errors.length === 1 ? "issue" : "issues"}`
              : run.status === "interrupted"
                ? "Interrupted walkthrough"
                : "Completed walkthrough"}
          </span>
          <Icon name={expanded ? "caret-down" : "caret-up"} class="ml-auto text-[10px]" />
        </Button>
        {!!errors.length && (
          <Button
            variant="subtle"
            size="xs"
            class="gap-1.5 text-destructive hover:text-destructive"
            onClick={onShowOutput}
          >
            See Output
            <Icon name="caret-right" class="text-xs" />
          </Button>
        )}
      </div>
      {expanded && (
        <ScrollArea id={`test-report-${run.sessionId}`} class="min-h-0 px-4 pb-3">
          {finished && (
            <p
              class="max-w-[100ch] text-xs leading-5 text-foreground/90"
              data-testid="test-run-summary"
            >
              {summarizeTestRun(run, activities)}
            </p>
          )}
          {!!errors.length && (
            <div class={finished ? "mt-3" : ""}>
              {finished && <h3 class="mb-1 text-[11px] font-medium text-destructive">Errors</h3>}
              <ul aria-label="Test errors" class="space-y-2">
                {errors.map((error, index) => (
                  <li
                    key={index}
                    class="min-w-0 border-l-2 border-destructive/60 pl-3 text-xs leading-5"
                  >
                    <p class="break-words text-destructive">{error.label}</p>
                    {error.details && (
                      <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-muted-foreground">
                        {error.details}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ScrollArea>
      )}
    </section>
  );
}
