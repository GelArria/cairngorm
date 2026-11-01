import { useMcpSettings } from "@/plugins/hooks/use-mcp-settings";
// Settings ▸ MCP servers: every server the installed agent CLIs are configured with,
// user-wide and for the active project, with add and remove.
import { AgentScopeBadge } from "@/agent/agent-scope-badge";
import { baseName } from "@/common/filesystem/fs-ops";
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { ConfirmDialog } from "@/common/ui/confirm-dialog";
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import { ProviderLogo } from "@/integrations/components/provider-logo";
import { SettingsFilterTabs, SettingsSearch } from "@/settings/components/settings-controls";
import { SettingsPage } from "@/settings/components/settings-layout";
import { McpAddDialog } from "./components/mcp-add-dialog";
import { McpServerRow } from "./components/mcp-server-row";

export function McpSettings({ open }: { open: boolean }) {
  const {
    project,
    inventory,
    loading,
    refresh,
    add,
    query,
    setQuery,
    setAgent,
    adding,
    setAdding,
    removing,
    setRemoving,
    removeError,
    setRemoveError,
    busy,
    setRowError,
    servers,
    tabs,
    filter,
    shown,
    message,
    confirmRemove,
  } = useMcpSettings({ open });

  return (
    <SettingsPage
      title="MCP servers"
      badge={<AgentScopeBadge scope="cli" />}
      description="MCP servers your agent CLIs already use, read from each one's configuration. The Cairngorm agent does not use them. Changes keep each file's formatting; user-wide configs also get a one-time backup beside them."
      data-testid="mcp-settings"
      aria-busy={loading}
      actions={
        <>
          <Button
            variant="subtle"
            size="icon-sm"
            aria-label="Refresh servers"
            title="Refresh servers"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <Icon name="arrows-clockwise" class={cn("text-xs", loading && "animate-spin")} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="gap-1.5"
            disabled={!inventory?.agents.length}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" />
            Add server
          </Button>
        </>
      }
    >
      <div class="flex flex-wrap items-center gap-2">
        <SettingsSearch value={query} onChange={setQuery} label="Filter servers" class="flex-1" />
        <Badge variant="outline" class="gap-1.5 py-1">
          <Icon name="folder" />
          {project ? baseName(project) : "No project open"}
        </Badge>
      </div>
      {tabs.length > 2 && (
        <SettingsFilterTabs
          tabs={tabs.map((tab) => ({
            ...tab,
            icon: tab.id === "all" ? undefined : <ProviderLogo id={tab.id} class="h-3.5 w-3.5" />,
          }))}
          active={filter}
          onSelect={setAgent}
          label="Agents"
        />
      )}
      {message && (
        <p role="alert" class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {message}
        </p>
      )}
      {inventory === null ? (
        <p class="text-xs text-muted-foreground">{loading ? "Reading agent configs…" : ""}</p>
      ) : inventory.agents.length === 0 ? (
        <p class="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
          No supported agent CLI was found on this machine.
        </p>
      ) : shown.length === 0 ? (
        <p class="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
          {servers.length === 0 ? "No MCP servers configured yet." : "No servers match."}
        </p>
      ) : (
        <ul class="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
          {shown.map((server) => (
            <McpServerRow
              key={`${server.agent}:${server.scope}:${server.name}`}
              server={server}
              onError={setRowError}
              onRemove={() => {
                setRemoveError(undefined);
                setRemoving(server);
              }}
            />
          ))}
        </ul>
      )}
      <p class="text-[11px] leading-snug text-muted-foreground">
        Agents read their configuration when they start: restart a running agent to pick up a
        change. Project servers come from the folder open in Cairngorm.
      </p>
      <McpAddDialog
        open={adding}
        agents={inventory?.agents ?? []}
        onCancel={() => setAdding(false)}
        onAdd={async (agents, server) => {
          const failure = await add(agents, server);
          if (!failure) {
            setAdding(false);
          }
          return failure;
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? "server"}?`}
        message={
          removing
            ? `${removing.agentName} will stop loading this server. It is removed from ${removing.configPath}.`
            : ""
        }
        confirmLabel="Remove"
        pending={busy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </SettingsPage>
  );
}
