import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { Dialog } from "@/common/ui/dialog";
import { Input } from "@/common/ui/input";
import { Label } from "@/common/ui/label";
import { usePluginClients } from "../hooks/use-plugin-clients";
import type { ClientFormat, PluginsState } from "../model/types";
import { PluginAgents } from "./plugin-agents";

export function PluginClientSettings({
  state,
  onState,
}: {
  state: PluginsState;
  onState: (state: PluginsState) => void;
}) {
  const form = usePluginClients(onState);
  const clients = (state.clients ?? []).map((client) => ({
    ...client,
    custom: true,
    lastSeen: client.activity?.lastSeen,
  }));
  const discovered = (state.discoveredClients ?? []).map((activity) => ({
    id: `detected-${activity.id}`,
    name: activity.name,
    configPath: "Detected through MCP",
    registered: true,
    lastSeen: activity.lastSeen,
    activity,
  }));
  return (
    <div class="flex flex-col gap-2">
      {(clients.length > 0 || discovered.length > 0) && (
        <PluginAgents
          agents={[...clients, ...discovered]}
          anyEnabled={state.plugins.some((p) => p.enabled)}
          busy={form.busy}
          onConnectionChange={form.connect}
          onRemove={form.setRemoving}
        />
      )}
      <div>
        <Button variant="outline" size="sm" disabled={form.busy} onClick={form.show}>
          Connect another MCP client
        </Button>
      </div>
      <p class="text-[11px] leading-snug text-muted-foreground">
        Register any CLI with MCP tools support, then enable its connection with the switch. Only
        its cairngorm entry is changed; a configuration backup is kept. No client code changes are
        needed.
      </p>
      {form.error && !form.open && !form.removing && (
        <p role="alert" class="text-xs text-destructive">
          {form.error}
        </p>
      )}
      <Dialog open={form.open} onClose={form.close} title="Register an MCP client" class="max-w-md">
        <form onSubmit={form.add} class="flex flex-col gap-3 px-5 py-4">
          <p class="text-xs text-muted-foreground">
            Select the CLI's existing configuration. Registering does not edit it or run the CLI.
          </p>
          <div class="space-y-1">
            <Label for="plugin-client-name">Client name</Label>
            <Input
              id="plugin-client-name"
              value={form.name}
              autoFocus
              maxLength={80}
              required
              onInput={(e) => form.setName(e.currentTarget.value)}
              placeholder="My CLI"
            />
          </div>
          <div class="space-y-1">
            <Label for="plugin-client-path">MCP configuration file</Label>
            <div class="flex gap-2">
              <Input
                id="plugin-client-path"
                class="min-w-0 font-mono text-xs"
                value={form.path}
                required
                onInput={(e) => form.setPath(e.currentTarget.value)}
                placeholder="Absolute path to the config file"
              />
              <Button type="button" variant="outline" size="sm" onClick={() => void form.browse()}>
                Browse
              </Button>
            </div>
          </div>
          <div class="space-y-1">
            <Label for="plugin-client-format">Configuration format</Label>
            <select
              id="plugin-client-format"
              value={form.format}
              disabled={form.busy}
              class="h-9 w-full rounded-md border border-border bg-background px-2 text-xs"
              onChange={(e) => form.setFormat(e.currentTarget.value as ClientFormat)}
            >
              <option value="json">JSON / JSONC — mcpServers</option>
              <option value="typed-json">JSON / JSONC — typed stdio</option>
              <option value="open-code">JSON / JSONC — command array (OpenCode)</option>
              <option value="copilot">JSON — local tools (Copilot)</option>
              <option value="toml">TOML — mcp_servers</option>
            </select>
          </div>
          {form.error && (
            <p role="alert" class="text-xs text-destructive">
              {form.error}
            </p>
          )}
          <div class="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={form.busy} onClick={form.close}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={form.busy || !form.name.trim() || !form.path.trim()}
            >
              {form.busy ? "Registering…" : "Register client"}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={form.removing !== null}
        title="Remove MCP client"
        message="Remove this client and its Cairngorm connection? Other servers and settings stay unchanged. A running agent may need to be reloaded."
        confirmLabel="Remove client"
        pending={form.busy}
        error={form.error ?? undefined}
        onCancel={() => form.setRemoving(null)}
        onConfirm={() => void form.remove()}
      />
    </div>
  );
}
