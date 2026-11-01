import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { TestBrowserControls } from "./test-browser";
import { TestResultFilters } from "./test-result-filters";

import type { useTestPaneState } from "../hooks/use-test-pane-state";
export function TestPaneToolbar({ pane }: { pane: ReturnType<typeof useTestPaneState> }) {
  const {
    sessionId,
    run,
    view,
    setView,
    sidebarVisible,
    setSidebarVisible,
    hasScreen,
    filter,
    query,
    follow,
    setFollow,
    displayed,
    paused,
    toggleFailed,
    setQuery,
  } = pane;
  return (
    <div class="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-card/40 px-3 py-1.5">
      <div
        class="flex shrink-0 gap-0.5 rounded-md bg-muted/60 p-0.5"
        role="group"
        aria-label="Test view"
      >
        {(hasScreen || !run || run.runner === "Playwright") && (
          <Button
            variant="subtle"
            size="xs"
            class="gap-1.5 aria-pressed:bg-background aria-pressed:shadow-sm"
            aria-pressed={view === "app"}
            onClick={() => setView("app")}
          >
            <Icon name="terminal-window" class="text-xs" />
            App
          </Button>
        )}
        <Button
          variant="subtle"
          size="xs"
          disabled={!run}
          class="gap-1.5 aria-pressed:bg-background aria-pressed:shadow-sm"
          aria-pressed={view === "results"}
          onClick={() => setView("results")}
        >
          <Icon name="check-circle" class="text-xs" />
          Results
        </Button>
        <Button
          variant="subtle"
          size="xs"
          disabled={!run}
          class="gap-1.5 aria-pressed:bg-background aria-pressed:shadow-sm"
          aria-pressed={view === "output"}
          onClick={() => setView("output")}
        >
          <Icon name="terminal" class="text-xs" />
          Output
        </Button>
        <Button
          variant="subtle"
          size="xs"
          class="gap-1.5 aria-pressed:bg-background aria-pressed:shadow-sm"
          aria-pressed={view === "preview"}
          onClick={() => setView("preview")}
        >
          <Icon name="terminal-window" class="text-xs" />
          Browser
        </Button>
      </div>
      {view === "app" ? (
        <>
          <TestBrowserControls stream={displayed} paused={paused} />
          <Tooltip
            content={sidebarVisible ? "Hide test sidebar" : "Show test sidebar"}
            side="bottom"
          >
            <Button
              variant="subtle"
              size="icon-sm"
              aria-label={sidebarVisible ? "Hide test sidebar" : "Show test sidebar"}
              aria-expanded={sidebarVisible}
              aria-controls={`test-sidebar-${sessionId}`}
              onClick={() => setSidebarVisible(!sidebarVisible)}
            >
              <Icon name="layout" class="text-xs" />
            </Button>
          </Tooltip>
        </>
      ) : view === "output" ? (
        <Button
          variant="subtle"
          size="xs"
          class="ml-auto gap-1.5"
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
        >
          <Icon name="arrow-down" class="text-xs" />
          Follow output
        </Button>
      ) : view === "results" ? (
        <TestResultFilters
          class="ml-auto min-w-40 max-w-80 flex-1"
          failedOnly={filter === "failed"}
          query={query}
          onToggle={toggleFailed}
          onQuery={setQuery}
        />
      ) : null}
    </div>
  );
}
