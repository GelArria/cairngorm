import { openSettings } from "@/common/events/app-events";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import { lastSeenLabel, type UsageReport } from "../data/ai-usage";
import { useAiUsage } from "../hooks/use-ai-usage";
import { ProviderLogo } from "./provider-logo";
import { UsageMeter } from "./usage-meter";

function ProviderUsage({ report }: { report: UsageReport }) {
  return (
    <div class="border-t border-border px-2.5 py-2" data-testid={`usage-${report.id}`}>
      <div class="mb-1 flex items-center gap-2">
        <ProviderLogo id={report.id} />
        <span class="flex-1 text-xs font-medium">{report.name}</span>
        {report.plan && (
          <Badge variant="muted" class="capitalize">
            {report.plan}
          </Badge>
        )}
      </div>
      {report.error ? (
        <p class="text-[11px] text-destructive">{report.error}</p>
      ) : report.windows.length === 0 ? (
        report.note && (
          <p class="text-[11px] leading-relaxed text-muted-foreground">{report.note}</p>
        )
      ) : (
        <div class="flex flex-col gap-2 py-1">
          {report.windows.map((w) => (
            <UsageMeter key={w.label} window={w} />
          ))}
          {report.warning && <p class="text-[11px] text-destructive">{report.warning}</p>}
          {lastSeenLabel(report) && (
            <p class="text-[11px] text-muted-foreground">{lastSeenLabel(report)}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function UsagePanel() {
  const { snapshot, loading, error, refresh } = useAiUsage();
  const reports = snapshot?.reports ?? [];
  return (
    <div class="w-[min(300px,85vw)] p-1" data-testid="usage-panel">
      <div class="flex items-center gap-2 px-2.5 pb-1.5 pt-1">
        <div class="flex-1">
          <div class="text-xs font-semibold text-foreground">AI usage</div>
          <div class="text-[11px] text-muted-foreground">
            {snapshot
              ? `Updated ${snapshot.checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Subscription limits"}
          </div>
        </div>
        <Button
          variant="subtle"
          size="icon-sm"
          aria-label="Refresh usage"
          title="Refresh usage"
          disabled={loading}
          onClick={refresh}
        >
          <Icon name="arrows-clockwise" class={cn("text-xs", loading && "animate-spin")} />
        </Button>
      </div>
      {error && (
        <p class="border-t border-border px-2.5 py-2 text-[11px] text-destructive">{error}</p>
      )}
      {!snapshot && loading && (
        <p class="border-t border-border px-2.5 py-3 text-[11px] text-muted-foreground">
          Checking signed-in subscriptions…
        </p>
      )}
      {reports.map((report) => (
        <ProviderUsage key={report.id} report={report} />
      ))}
      {snapshot && reports.length === 0 && (
        <p class="border-t border-border px-2.5 py-2 text-[11px] text-muted-foreground">
          No subscription is signed in. Sign in to Codex, Claude Code or Gemini CLI with your
          ChatGPT, Claude or Google AI plan to see it here.
        </p>
      )}
      <div class="-mx-1 mt-1 border-t border-border px-1 pt-1">
        <DropdownMenuItem class="gap-2 text-xs" onClick={() => openSettings("providers")}>
          <Icon name="gear-six" class="text-sm text-muted-foreground" />
          AI providers
        </DropdownMenuItem>
      </div>
    </div>
  );
}
