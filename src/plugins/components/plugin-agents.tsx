// Agent CLIs that can reach plugins: active (talked to Cairngorm from one of its
// terminals since the app started), configured (bridge registered) or not connected.
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Toggle } from "@/common/ui/toggle";
import { cn } from "@/common/utils";
import type { AgentRegistration } from "../model/types";

export function formatAgo(seconds: number): string {
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** Recent MCP contact; this does not prove the client exposed tools to its model. */
export const ACTIVE_FOR = 600;

function status(agent: AgentRegistration, anyEnabled: boolean) {
  const seen = agent.lastSeen;
  if (agent.registered && !agent.error && agent.activity && !agent.activity.synced) {
    return {
      label: "Refresh required",
      active: false,
      dot: "bg-amber-500",
      detail: "Reload if tools do not refresh automatically",
    };
  }
  if (!anyEnabled || agent.error) {
    return {
      label: anyEnabled ? "Not connected" : "Off",
      active: false,
      dot: "bg-transparent ring-1 ring-border",
      detail: null,
    };
  }
  if (agent.registered && seen != null && seen < ACTIVE_FOR) {
    return {
      label: "Connected",
      active: true,
      dot: "bg-emerald-500",
      detail: `${agent.activity?.synced ? "Catalog read · " : ""}Seen ${formatAgo(seen)}`,
    };
  }
  if (agent.registered) {
    return {
      label: seen == null ? "Restart required" : "Configured",
      active: false,
      dot: "bg-muted-foreground",
      detail: seen != null ? `Seen ${formatAgo(seen)}` : "Start or restart it to use plugins",
    };
  }
  return {
    label: anyEnabled ? "Not connected" : "Off",
    active: false,
    dot: "bg-transparent ring-1 ring-border",
    detail: null,
  };
}

export function PluginAgents({
  agents,
  anyEnabled,
  busy = false,
  onConnectionChange,
  onRemove,
}: {
  agents: AgentRegistration[];
  anyEnabled: boolean;
  busy?: boolean;
  onConnectionChange?: (id: string, enabled: boolean) => void;
  onRemove?: (id: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <p class="text-xs text-muted-foreground">No supported agent CLI was found on this machine.</p>
    );
  }
  return (
    <ul class="flex flex-col divide-y divide-border rounded-lg border border-border">
      {agents.map((agent) => {
        const s = status(agent, anyEnabled);
        return (
          <li
            key={agent.id}
            class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
            data-testid={`plugin-agent-${agent.id}`}
          >
            <span aria-hidden="true" class={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
            <div class="min-w-0 flex-1">
              <div class="text-xs text-foreground">{agent.name}</div>
              <code
                class="block truncate font-mono text-[11px] text-muted-foreground"
                title={agent.configPath}
              >
                {agent.configPath}
              </code>
            </div>
            {s.detail && <span class="text-[11px] text-muted-foreground">{s.detail}</span>}
            <Badge variant={s.active ? "secondary" : "outline"}>{s.label}</Badge>
            {agent.custom && (
              <>
                <Toggle
                  checked={agent.registered}
                  disabled={busy}
                  aria-label={`Connect ${agent.name}`}
                  onCheckedChange={(enabled) => onConnectionChange?.(agent.id, enabled)}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Remove ${agent.name}`}
                  onClick={() => onRemove?.(agent.id)}
                >
                  Remove
                </Button>
              </>
            )}
            {agent.error && <p class="w-full text-[11px] text-destructive">{agent.error}</p>}
          </li>
        );
      })}
    </ul>
  );
}
