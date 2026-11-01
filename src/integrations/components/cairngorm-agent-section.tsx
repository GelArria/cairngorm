// The Cairngorm agent: the app's own agent, behind every AI feature Cairngorm runs itself.
// Agent CLIs run in terminals do not use it. Its model endpoint is configured here; a
// verified subscription can stand in for it.
import { AgentSettings } from "@/agent/agent-settings";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";

const USES = ["Agent tabs", "Scheduled tasks", "Commit messages", "Summaries"];

export function CairngormAgentSection({
  open,
  subscriptionName,
  busy,
  onUseEndpoint,
}: {
  open: boolean;
  /** The verified subscription currently standing in for the endpoint, if any. */
  subscriptionName: string | null;
  busy: boolean;
  onUseEndpoint: () => void;
}) {
  return (
    <section
      class="overflow-hidden rounded-lg border border-border"
      aria-label="Cairngorm agent"
      data-testid="cairngorm-agent"
    >
      <header class="flex flex-wrap items-start gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-base">
          <Icon name="plug" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="text-[13px] font-semibold">Cairngorm agent</h4>
          </div>
          <p class="mt-1 max-w-[62ch] text-[11px] leading-relaxed text-muted-foreground">
            Cairngorm's own agent. The features below run through it and stay off until it is set
            up. CLIs you run in your terminals do not go through it, though a verified subscription
            can power it.
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] text-muted-foreground">Used by</span>
            {USES.map((use) => (
              <Badge key={use} variant="muted">
                {use}
              </Badge>
            ))}
          </div>
        </div>
      </header>
      <div class="px-4 py-4">
        <h5 class="mb-3 text-xs font-medium text-muted-foreground">Model endpoint</h5>
        <AgentSettings open={open} />
        {subscriptionName && (
          <div class="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <p class="min-w-[200px] flex-1 text-[11px] leading-relaxed text-muted-foreground">
              {subscriptionName} is verified and in use. Saving endpoint fields keeps it selected.
            </p>
            <Button variant="outline" size="sm" disabled={busy} onClick={onUseEndpoint}>
              Use this endpoint instead
            </Button>
          </div>
        )}
        <p class="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          Cloud, gateway or local server (Ollama, LM Studio). Endpoint billing is separate from any
          CLI subscription.
        </p>
      </div>
    </section>
  );
}
