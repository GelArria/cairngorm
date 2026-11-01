import { openDefault } from "@/common/filesystem/fs-ops";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { cn } from "@/common/utils";
import { AgentMark } from "@/integrations/components/provider-logo";
import type { McpServer } from "../data/mcp-api";

const SCOPES: Record<McpServer["scope"], string> = {
  user: "All projects",
  local: "This project (private)",
  project: "This project (shared)",
};

export function McpServerRow({
  server,
  onRemove,
  onError,
}: {
  server: McpServer;
  onRemove: () => void;
  onError: (message: string) => void;
}) {
  return (
    <li
      class="flex items-start gap-3 px-4 py-3"
      data-testid={`mcp-${server.agent}-${server.scope}-${server.name}`}
    >
      <AgentMark
        id={server.agent}
        name={server.agentName}
        class={cn(!server.enabled && "opacity-50")}
      />
      <div class={cn("min-w-0 flex-1", !server.enabled && "opacity-60")}>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-xs font-semibold text-foreground">{server.name}</span>
          <Badge variant="outline" class="uppercase tracking-wide">
            {server.transport}
          </Badge>
          {server.managed && <Badge variant="secondary">Cairngorm plugins</Badge>}
          {!server.enabled && <Badge variant="muted">Off</Badge>}
        </div>
        <div class="mt-0.5 text-[11px] text-muted-foreground">
          {server.agentName} · {SCOPES[server.scope]}
        </div>
        <code
          class="mt-1 block truncate font-mono text-[11px] text-foreground/80"
          title={server.target}
        >
          {server.target || "No command or URL"}
        </code>
        <code
          class="block truncate font-mono text-[10.5px] text-muted-foreground/70"
          title={server.configPath}
        >
          {server.configPath}
        </code>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openDefault(server.configPath).catch((e) => onError(String(e)))}
        >
          Open config
        </Button>
        {!server.managed && (
          <Button variant="outline" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}
