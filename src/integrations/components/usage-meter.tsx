import { useShowRemaining } from "@/integrations/hooks/use-usage-display";
// One subscription limit as a labelled bar, shown as used or remaining per the user's
// "Show remaining usage" preference, which the footer panel and Settings share.
import { Progress } from "@/common/ui/progress";
import { cn } from "@/common/utils";
import { resetLabel, type UsageWindow } from "../data/ai-usage";

export function UsageMeter({ window: limit }: { window: UsageWindow }) {
  const remaining = useShowRemaining();
  // A CLI can report more than 100% once a limit is passed; the bar stays within 0-100.
  const used = Math.min(100, Math.max(0, Math.round(limit.usedPercent)));
  const shown = remaining ? 100 - used : used;
  const reset = resetLabel(limit);
  return (
    <div class="min-w-0 space-y-1" data-testid={`usage-window-${limit.kind}`}>
      <div class="flex items-baseline gap-2 text-[11px]">
        <span class="flex-1 truncate text-foreground/90">{limit.label}</span>
        <span class="tabular-nums text-muted-foreground">
          {shown}% {remaining ? "left" : "used"}
        </span>
      </div>
      <Progress
        value={shown}
        aria-label={`${limit.label} ${remaining ? "remaining" : "usage"}`}
        indicatorClass={cn(used >= 90 ? "bg-destructive" : used >= 75 && "bg-amber-500")}
      />
      {reset && <div class="truncate text-[10.5px] text-muted-foreground">{reset}</div>}
    </div>
  );
}
