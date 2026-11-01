import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { ScrollArea } from "@/common/ui/scroll-area";
import { BrowserPreview } from "./components/browser-preview";
import { TestBrowser, TestBrowserTabs } from "./components/test-browser";
import { TestExecutionResult } from "./components/test-execution-result";
import { TestPaneFooter } from "./components/test-pane-footer";
import { TestPaneHeader } from "./components/test-pane-header";
import { TestPaneToolbar } from "./components/test-pane-toolbar";
import { TestRunReportPanel } from "./components/test-run-report-panel";
import { TestWalkthrough } from "./components/test-walkthrough";
import { useTestPaneState } from "./hooks/use-test-pane-state";

const colors = {
  passed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
};

export function TestPane({
  sessionId,
  sourceTitle,
  onShowTerminal,
}: {
  sessionId: string;
  sourceTitle: string;
  onShowTerminal: () => void;
}) {
  const pane = useTestPaneState(sessionId);
  const {
    run,
    streams,
    view,
    setView,
    selectedPage,
    sidebarVisible,
    filter,
    query,
    setFollow,
    now,
    outputRef,
    stream,
    displayed,
    paused,
    togglePause,
    pauseError,
    rows,
    selectPage,
  } = pane;
  return (
    <section
      class="surface-base flex h-full min-w-0 flex-col bg-background font-sans text-foreground"
      aria-label="Live test results"
      data-testid="test-pane"
    >
      <TestPaneHeader
        run={run}
        now={now}
        sourceTitle={sourceTitle}
        onShowTerminal={onShowTerminal}
      />
      <TestPaneToolbar pane={pane} />
      {pauseError && (
        <p class="px-3 py-2 text-xs text-destructive" role="alert">
          {pauseError}
        </p>
      )}
      {view === "app" && (
        <TestBrowserTabs streams={streams} stream={displayed} onSelect={selectPage}>
          <Button
            variant="subtle"
            size="xs"
            aria-pressed={!selectedPage}
            onClick={() => selectPage()}
            title="Automatically select the newest active test page"
          >
            Follow tests
          </Button>
          <Button
            variant="subtle"
            size="xs"
            disabled={!stream}
            aria-pressed={paused}
            onClick={() => void togglePause()}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        </TestBrowserTabs>
      )}
      <div
        key="test-content"
        class={`flex min-h-0 flex-1 ${view === "app" ? "flex-col lg:flex-row" : "flex-col"}`}
      >
        {view === "preview" && (
          <BrowserPreview key="preview" initialUrl={stream?.url} onLive={() => setView("app")} />
        )}
        {view === "app" && (
          <>
            <TestBrowser stream={displayed} />
            {run && sidebarVisible && (
              <aside
                id={`test-sidebar-${sessionId}`}
                data-testid="test-walkthrough-sidebar"
                aria-label="Walkthrough sidebar"
                class="max-h-32 min-h-0 shrink-0 border-t border-border/70 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0 [@media(max-height:500px)]:hidden"
              >
                <TestWalkthrough
                  sessionId={sessionId}
                  pageId={displayed?.pageId}
                  startedAt={run.startedAt}
                />
              </aside>
            )}
          </>
        )}
        {run &&
          (view === "output" ? (
            <ScrollArea
              viewportRef={outputRef}
              class="min-h-0 flex-1 bg-muted/10 p-4"
              onScroll={() => {
                pane.rememberScroll();
                const el = outputRef.current;
                if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 40) {
                  setFollow(false);
                }
              }}
            >
              <pre class="whitespace-pre-wrap break-words font-mono text-xs leading-5">
                {run.output.join("\n")}
              </pre>
            </ScrollArea>
          ) : (
            view === "results" && (
              <div class="flex min-h-0 flex-1 flex-col">
                <ScrollArea class="min-h-0 flex-1">
                  <TestExecutionResult run={run} />
                  {rows.length ? (
                    <ul class="divide-y divide-border/40" aria-label="Detected test results">
                      {rows.map((r) => (
                        <li
                          key={r.name}
                          class={`flex items-start gap-3 px-4 py-3 text-xs leading-5 ${r.status === "failed" ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/40"}`}
                        >
                          <Icon
                            name={
                              r.status === "passed"
                                ? "check-circle"
                                : r.status === "failed"
                                  ? "warning-circle"
                                  : "minus"
                            }
                            class={`mt-0.5 text-base ${colors[r.status]}`}
                          />
                          <span
                            class={`min-w-0 flex-1 break-words ${r.status === "failed" ? "font-medium" : ""}`}
                          >
                            {r.name}
                          </span>
                          <span
                            class={`shrink-0 text-[11px] capitalize ${r.status === "failed" ? "font-medium text-destructive" : "text-muted-foreground"}`}
                          >
                            {r.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    (query || filter !== "all") && (
                      <p class="px-4 py-6 text-xs leading-5 text-muted-foreground">
                        No matching results.
                      </p>
                    )
                  )}
                </ScrollArea>
              </div>
            )
          ))}
      </div>
      {run && view === "app" && (
        <div class="shrink-0 [@media(max-height:500px)]:hidden">
          <TestRunReportPanel run={run} onShowOutput={() => setView("output")} />
        </div>
      )}
      {!run && (
        <p class="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Waiting for test output from {sourceTitle}. Run your tests in that terminal to follow them
          here.
        </p>
      )}
      <TestPaneFooter
        stream={view === "app" ? displayed : undefined}
        sourceTitle={sourceTitle}
        command={run?.command}
        output={view === "output"}
      />
    </section>
  );
}
