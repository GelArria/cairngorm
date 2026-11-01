import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { ScrollArea } from "@/common/ui/scroll-area";
import { useBrowserActivities } from "@/testing/hooks/use-browser-activities";
import { useEffect, useRef, useState } from "preact/hooks";

export function TestWalkthrough({
  sessionId,
  pageId,
  startedAt,
}: {
  sessionId: string;
  pageId?: string;
  startedAt: number;
}) {
  const activities = useBrowserActivities(sessionId).filter((a) => !pageId || a.pageId === pageId);
  const [expanded, setExpanded] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const active = activities.filter((a) => a.status === "running");
  const latest = active.at(-1) ?? activities.at(-1);
  useEffect(() => {
    const compact = window.matchMedia("(max-height: 480px)");
    const adapt = () => setExpanded(!compact.matches);
    adapt();
    compact.addEventListener("change", adapt);
    return () => compact.removeEventListener("change", adapt);
  }, []);
  useEffect(() => {
    if (follow.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [activities.length, latest?.timestamp, expanded]);
  return (
    <section
      class="flex h-full min-h-0 flex-col bg-card/60"
      data-testid="test-walkthrough"
      aria-label="Test walkthrough"
    >
      <Button
        variant="ghost"
        class="h-9 min-w-0 shrink-0 justify-start gap-2 rounded-none border-b border-border/50 px-4 text-xs"
        aria-expanded={expanded}
        aria-controls={`walkthrough-${sessionId}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span class="shrink-0 font-medium">Walkthrough</span>
        <span class="shrink-0 tabular-nums text-muted-foreground">
          {activities.filter((a) => a.status === "completed").length} done
        </span>
        <Icon
          name={expanded ? "caret-down" : "caret-up"}
          class="ml-auto text-xs text-muted-foreground"
        />
      </Button>
      {expanded && (
        <ScrollArea
          id={`walkthrough-${sessionId}`}
          viewportRef={viewport}
          class="min-h-0 flex-1 px-3 py-2"
          onScroll={() => {
            const el = viewport.current;
            if (el) {
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
            }
          }}
        >
          {activities.length ? (
            <ol aria-label="Walkthrough timeline">
              {activities.map((a) => (
                <li
                  key={`${a.pageId}-${a.activityId}`}
                  class={`relative grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2 gap-y-1 rounded-md px-1 py-2.5 text-xs leading-4 after:absolute after:bottom-0 after:left-[13px] after:top-8 after:w-px after:bg-border last:after:hidden ${a.status === "running" ? "bg-accent/60" : a.status === "failed" ? "bg-destructive/5" : ""}`}
                  data-status={a.status}
                >
                  <span
                    class={`flex h-5 w-5 items-center justify-center rounded-full ${a.status === "running" ? "bg-foreground text-background" : a.status === "completed" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : a.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
                  >
                    <Icon
                      name={
                        a.status === "running"
                          ? "spinner"
                          : a.status === "completed"
                            ? "check"
                            : a.status === "failed"
                              ? "x"
                              : "minus"
                      }
                      class={`text-xs ${a.status === "running" ? "motion-safe:animate-spin" : ""}`}
                    />
                  </span>
                  <span
                    class={`min-w-0 break-words ${a.status === "running" || a.status === "failed" ? "font-medium text-foreground" : "text-foreground/80"}`}
                  >
                    {a.label}
                    <span class="sr-only"> · {a.status}</span>
                  </span>
                  <div class="col-start-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span class="font-mono tabular-nums" title="Time since test started">
                      +{Math.max(0, (a.startedAt - startedAt) / 1000).toFixed(1)}s
                    </span>
                    <span>
                      {a.status === "running"
                        ? "Now"
                        : a.status === "completed"
                          ? `${((a.timestamp - a.startedAt) / 1000).toFixed(1)}s`
                          : a.status === "failed"
                            ? "Failed"
                            : "Stopped"}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p class="px-1 py-2 text-xs leading-5 text-muted-foreground">
              Navigation, clicks and form actions appear here as the test runs.
            </p>
          )}
        </ScrollArea>
      )}
    </section>
  );
}
