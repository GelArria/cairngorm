// Settings ▸ Plugins: a searchable catalog of services grouped by category, and the
// agent CLIs that reach them.
import { AgentScopeBadge } from "@/agent/agent-scope-badge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { SettingsGroupTitle, SettingsPage } from "@/settings/components/settings-layout";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "preact/hooks";
import { AgentConfigCleanup } from "./components/agent-config-cleanup";
import { AlwaysAllowedApps } from "./components/always-allowed-apps";
import { FileAccessSettings } from "./components/file-access-settings";
import { PluginAgents } from "./components/plugin-agents";
import { PluginConnectDialog } from "./components/plugin-connect-dialog";
import { PluginClientSettings } from "./components/plugin-client-settings";
import { PluginRow } from "./components/plugin-row";
import { usePlugins } from "./hooks/use-plugins";
import type { PluginInfo, PluginsState } from "./model/types";

/** Shelves in catalog order; a search matches name, description or category. */
export function groupPlugins(plugins: PluginInfo[], query: string): [string, PluginInfo[]][] {
  const needle = query.trim().toLowerCase();
  const shelves = new Map<string, PluginInfo[]>();
  for (const plugin of plugins) {
    const text = `${plugin.name} ${plugin.description} ${plugin.category}`.toLowerCase();
    if (needle && !text.includes(needle)) {
      continue;
    }
    shelves.set(plugin.category, [...(shelves.get(plugin.category) ?? []), plugin]);
  }
  return [...shelves];
}

export function PluginSettings({ open }: { open: boolean }) {
  const {
    state,
    acceptState,
    busy,
    error,
    setEnabled,
    setFilesAccess,
    cancelSignIn,
    connection,
    connectAgents,
    cancelConnection,
    confirmConnection,
  } = usePlugins(open);
  const [query, setQuery] = useState("");
  const shelves = useMemo(() => groupPlugins(state?.plugins ?? [], query), [state, query]);
  const anyEnabled = state?.plugins.some((p) => p.enabled) ?? false;
  return (
    <SettingsPage
      title="Plugins"
      badge={<AgentScopeBadge scope="cli" />}
      description="Connect your agent CLIs to remote services. The Cairngorm agent does not use plugins. Installed applications are ready for agent CLIs on their own, through the application's own automation API or MCP server; there is nothing to add."
      data-testid="plugin-settings"
      aria-busy={busy !== null}
      actions={
        <label class="relative block w-56 max-w-full">
          <Icon
            name="magnifying-glass"
            class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search plugins"
            aria-label="Search plugins"
            class="h-8 pl-8 text-xs"
          />
        </label>
      }
    >
      {(error || state?.error) && (
        <p role="alert" class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error || state?.error}
        </p>
      )}
      {state && (
        <FileAccessSettings
          access={state.filesAccess ?? (state.filesEnabled ? "always" : "ask")}
          available={!!state.filesAvailable}
          busy={busy !== null}
          open={open}
          onAccess={setFilesAccess}
        >
          <AlwaysAllowedApps grants={state.appGrants ?? []} onState={acceptState} />
        </FileAccessSettings>
      )}
      {state === null ? (
        <p class="text-xs text-muted-foreground">Loading…</p>
      ) : shelves.length === 0 ? (
        <p class="py-6 text-center text-xs text-muted-foreground">
          No plugins match “{query.trim()}”.
        </p>
      ) : (
        shelves.map(([category, plugins]) => {
          const id = `plugin-shelf-${category.toLowerCase().replace(/\W+/g, "-")}`;
          return (
            <section key={category} aria-labelledby={id} class="flex flex-col gap-1">
              <SettingsGroupTitle id={id}>{category}</SettingsGroupTitle>
              <ul class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4">
                {plugins.map((plugin) => (
                  <li key={plugin.id} class="min-w-0">
                    <PluginRow
                      plugin={plugin}
                      busy={busy?.id === plugin.id ? busy : null}
                      locked={busy !== null && busy.id !== plugin.id}
                      onEnabled={(next) => void setEnabled(plugin.id, next)}
                      onCancelSignIn={cancelSignIn}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {state && (
        <section aria-labelledby="plugin-agents" class="flex flex-col gap-2">
          <SettingsGroupTitle id="plugin-agents">Agent CLIs</SettingsGroupTitle>
          {!state.runtime && (
            <p class="text-xs text-muted-foreground">
              Install Node.js or Bun so agents can reach plugins.
            </p>
          )}
          {state.agents.length > 0 && (
            <PluginAgents agents={state.agents} anyEnabled={anyEnabled} />
          )}
          {open && <PluginClientSettings state={state} onState={acceptState} />}
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || !state.runtime}
              onClick={connectAgents}
            >
              {state.agentsConnected ? "Check agent connections" : "Connect agents"}
            </Button>
          </div>
          <p class="text-[11px] leading-snug text-muted-foreground">
            One connection serves every plugin. Start or restart an agent after connecting it.
            "Connected" confirms MCP access, not model visibility. Enable Cairngorm tools or tool
            discovery in your client. Check connections after installing another supported CLI.
            Plugin changes announce tool-list updates; clients that do not refresh show "Refresh
            required".
          </p>
          {state.bridgeConfig && (
            <details class="text-[11px] text-muted-foreground">
              <summary class="cursor-pointer">Other MCP clients</summary>
              <p class="py-2">
                Merge this entry into your client's MCP configuration, then start it in a Cairngorm
                terminal. Configuration formats may differ between clients. The client must expose
                the tools to its model, directly or through discovery. Current capabilities are also
                available at the MCP resource cairngorm://plugins.
              </p>
              <pre class="overflow-x-auto rounded-md bg-muted p-3 text-[11px]">
                {JSON.stringify(state.bridgeConfig, null, 2)}
              </pre>
            </details>
          )}
          <p class="text-[11px] leading-snug text-muted-foreground">
            Sign-ins stay in your system's credential store and removing a plugin signs out. Each
            service's own terms apply to its use.
          </p>
        </section>
      )}
      {state && (
        <AgentConfigCleanup
          open={open}
          onChanged={() =>
            void invoke<PluginsState>("plugins_state").then(acceptState).catch(console.error)
          }
        />
      )}
      <PluginConnectDialog
        open={open && connection !== null}
        onConfirm={confirmConnection}
        onCancel={cancelConnection}
      />
    </SettingsPage>
  );
}
