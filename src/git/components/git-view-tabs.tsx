// Changes / History tabs of the Git panel (roving focus with arrows, Home and End).
import { Button } from "@/common/ui/button";

export type GitTab = "changes" | "history";

export function GitViewTabs({
  tab,
  setTab,
  changes,
}: {
  tab: GitTab;
  setTab: (tab: GitTab) => void;
  /** Changed files, shown next to the Changes label. */
  changes: number;
}) {
  return (
    <div
      role="tablist"
      aria-label="Git views"
      class="mx-3 mt-3 flex shrink-0 border-b border-border"
    >
      {(["changes", "history"] as const).map((value) => (
        <Button
          key={value}
          id={`git-tab-${value}`}
          role="tab"
          tabIndex={tab === value ? 0 : -1}
          aria-selected={tab === value}
          aria-controls="git-view"
          variant="ghost"
          size="xs"
          class={`h-8 flex-1 rounded-none border-b ${tab === value ? "border-ring text-foreground" : "border-transparent text-muted-foreground"}`}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
              return;
            }
            e.preventDefault();
            const next =
              e.key === "Home"
                ? "changes"
                : e.key === "End"
                  ? "history"
                  : value === "changes"
                    ? "history"
                    : "changes";
            setTab(next);
            document.getElementById(`git-tab-${next}`)?.focus();
          }}
          onClick={() => setTab(value)}
        >
          {value === "changes" ? "Changes" : "History"}
          {value === "changes" && changes > 0 && (
            <span class="ml-1.5 text-[10px] tabular-nums text-muted-foreground">{changes}</span>
          )}
        </Button>
      ))}
    </div>
  );
}
