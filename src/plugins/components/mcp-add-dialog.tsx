import { useMcpAddDialog } from "@/plugins/hooks/use-mcp-add-dialog";
import { ITEM } from "@/plugins/model/mcp-add-dialog";
// Add one MCP server, user-wide, to the agent CLIs the user picks.
import { Button } from "@/common/ui/button";
import { Dialog } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { RadioGroup, RadioGroupItem, RadioIndicator } from "@/common/ui/radio-group";
import { Toggle } from "@/common/ui/toggle";
import { AgentMark } from "@/integrations/components/provider-logo";
import { type McpAgent, type NewMcpServer } from "../data/mcp-api";

export function McpAddDialog({
  open,
  agents,
  onCancel,
  onAdd,
}: {
  open: boolean;
  agents: McpAgent[];
  onCancel: () => void;
  /** Resolves with an error to keep the dialog open, or null when added everywhere. */
  onAdd: (agents: string[], server: NewMcpServer) => Promise<string | null>;
}) {
  const {
    name,
    setName,
    transport,
    setTransport,
    command,
    setCommand,
    url,
    setUrl,
    chosen,
    error,
    saving,
    nameOk,
    targetOk,
    submit,
    toggle,
  } = useMcpAddDialog({ open, agents, onAdd });

  return (
    <Dialog open={open} onClose={onCancel} title="Add MCP server" class="max-w-md">
      <form class="flex flex-col gap-4 px-5 py-4" onSubmit={submit}>
        <div class="flex flex-col gap-1.5">
          <Label for="mcp-name" class="text-xs">
            Name
          </Label>
          <Input
            id="mcp-name"
            autoFocus
            value={name}
            placeholder="github"
            spellcheck={false}
            class="h-8 font-mono text-xs"
            onInput={(e) => setName(e.currentTarget.value)}
          />
          {name && !nameOk && (
            <span class="text-[11px] text-destructive">Use letters, digits, - or _.</span>
          )}
        </div>
        <RadioGroup
          value={transport}
          onValueChange={(v) => setTransport(v as "stdio" | "http")}
          aria-label="Transport"
          class="grid grid-cols-2 gap-1.5"
        >
          <RadioGroupItem value="stdio" class={ITEM}>
            <RadioIndicator checked={transport === "stdio"} />
            Local command
          </RadioGroupItem>
          <RadioGroupItem value="http" class={ITEM}>
            <RadioIndicator checked={transport === "http"} />
            Remote URL
          </RadioGroupItem>
        </RadioGroup>
        {transport === "stdio" ? (
          <div class="flex flex-col gap-1.5">
            <Label for="mcp-command" class="text-xs">
              Command
            </Label>
            <Input
              id="mcp-command"
              value={command}
              placeholder="npx -y @modelcontextprotocol/server-github"
              spellcheck={false}
              class="h-8 font-mono text-xs"
              onInput={(e) => setCommand(e.currentTarget.value)}
            />
          </div>
        ) : (
          <div class="flex flex-col gap-1.5">
            <Label for="mcp-url" class="text-xs">
              URL
            </Label>
            <Input
              id="mcp-url"
              value={url}
              placeholder="https://mcp.example.com/mcp"
              spellcheck={false}
              class="h-8 font-mono text-xs"
              onInput={(e) => setUrl(e.currentTarget.value)}
            />
          </div>
        )}
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium">Add to</span>
          <ul class="flex flex-col divide-y divide-border rounded-md border border-border">
            {agents.map((agent) => (
              <li key={agent.id} class="flex items-center gap-2.5 px-2.5 py-1.5">
                <AgentMark id={agent.id} name={agent.name} class="size-6 rounded-md" />
                <span class="flex-1 text-xs">{agent.name}</span>
                <Toggle
                  checked={chosen.includes(agent.id)}
                  aria-label={`Add to ${agent.name}`}
                  onCheckedChange={(on) => toggle(agent.id, on)}
                />
              </li>
            ))}
          </ul>
          <span class="text-[11px] text-muted-foreground">
            Added for all projects. Each config keeps its formatting and a one-time backup.
          </span>
        </div>
        {error && (
          <p role="alert" class="whitespace-pre-line text-xs text-destructive">
            {error}
          </p>
        )}
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={saving || !nameOk || !targetOk || chosen.length === 0}
          >
            {saving ? "Adding…" : "Add server"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
