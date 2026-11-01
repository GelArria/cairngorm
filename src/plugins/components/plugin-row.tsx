// One catalog row: the service's logo, what it does, and its state (add, added, signing
// in, signed out). Links and removal live in the row's menu.
import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { BundledProviderAction } from "@/documents/bundled-provider-action";
import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { open as openLink } from "@tauri-apps/plugin-shell";
import type { PluginInfo } from "../model/types";

interface PluginRowProps {
  plugin: PluginInfo;
  /** This row is being added or removed (`enabled`: which way). */
  busy: { enabled: boolean } | null;
  /** Another row is busy: one sign-in at a time, so this one waits. */
  locked: boolean;
  onEnabled: (enabled: boolean) => void;
  onCancelSignIn: () => void;
}

/** Local applications need no adding: installed with an automation API means agents can use it. */
function AppStatus({ availability }: { availability: PluginInfo["availability"] }) {
  const ready = Boolean(availability?.driver);
  return (
    <Badge
      variant={ready ? "secondary" : "outline"}
      class="shrink-0 gap-1 font-normal"
      title={availability?.message}
    >
      {ready && <Icon name="check" />}
      {ready ? "Ready" : availability?.installed ? "No automation" : "Not found"}
    </Badge>
  );
}

function PluginAction({ plugin, busy, locked, onEnabled, onCancelSignIn }: PluginRowProps) {
  const oauth = plugin.auth === "oauth";
  if (plugin.localApp) {
    return <AppStatus availability={plugin.availability} />;
  }
  if (busy?.enabled && oauth && !plugin.signedIn) {
    return (
      <div class="flex shrink-0 items-center gap-2" role="status">
        <span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon name="spinner" class="motion-safe:animate-spin" />
          Finish in your browser
        </span>
        <Button size="xs" variant="outline" onClick={onCancelSignIn}>
          Cancel
        </Button>
      </div>
    );
  }
  if (busy) {
    return (
      <Icon name="spinner" class="mx-1.5 shrink-0 text-muted-foreground motion-safe:animate-spin" />
    );
  }
  if (plugin.enabled && oauth && !plugin.signedIn) {
    return (
      <Button
        size="xs"
        variant="outline"
        class="shrink-0 gap-1"
        aria-label={`Sign in to ${plugin.name}`}
        disabled={locked}
        onClick={() => onEnabled(true)}
      >
        <Icon name="sign-in" />
        Sign in
      </Button>
    );
  }
  if (plugin.enabled) {
    return (
      <span class="flex shrink-0 items-center gap-1 px-1 text-[11px] text-muted-foreground">
        <Icon name="check" />
        Added
      </span>
    );
  }
  return (
    <Button
      size="icon"
      variant="ghost"
      class="shrink-0"
      aria-label={`Add ${plugin.name}`}
      disabled={locked}
      title={oauth ? `Sign in with ${plugin.name} to add it` : `Add ${plugin.name}`}
      onClick={() => onEnabled(true)}
    >
      <Icon name="plus" class="text-base" />
    </Button>
  );
}

/** How agents reach a local application, and what opens in a pane. */
function appDetail(plugin: PluginInfo): string {
  const availability = plugin.availability;
  const pane = plugin.documentProvider ? " · built-in editor too" : "";
  if (availability?.driver === "mcp") {
    return `Local · Agents use its own MCP server${pane}`;
  }
  if (availability?.driver === "com") {
    return `Local · Agents use its automation API${pane}`;
  }
  if (plugin.documentProvider) {
    return "Opens in a Cairngorm pane · no app needed";
  }
  return availability?.installed ? "Local · No automation API" : "Local · Not found";
}

export function PluginRow(props: PluginRowProps) {
  const { plugin, busy, onEnabled } = props;
  return (
    <div
      class="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2"
      data-testid={`plugin-card-${plugin.id}`}
      role="group"
      aria-labelledby={`plugin-${plugin.id}`}
    >
      {/* Full colour on purpose: the service is recognised by its logo. */}
      {plugin.logo ? (
        <img
          src={plugin.logo}
          alt=""
          aria-hidden="true"
          width={36}
          height={36}
          class="size-9 shrink-0 rounded-lg ring-1 ring-border"
          data-testid="plugin-logo"
        />
      ) : (
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Icon name="plug" class="text-xl" />
        </span>
      )}
      <div class="min-w-0 flex-1">
        <div id={`plugin-${plugin.id}`} class="truncate text-[13px] font-medium text-foreground">
          {plugin.name}
        </div>
        <p class="truncate text-xs text-muted-foreground" title={plugin.description}>
          {plugin.description}
        </p>
        {!plugin.localApp && !plugin.documentProvider && (
          <p
            class="mt-1 text-[11px] leading-snug text-muted-foreground"
            data-testid="plugin-data-notice"
          >
            {plugin.name} receives what agents send to it. Treat its replies as untrusted.
          </p>
        )}
        {plugin.availability && (
          <p
            class="mt-1 truncate text-[11px] leading-snug text-muted-foreground"
            title={plugin.availability.message}
          >
            {appDetail(plugin)}
          </p>
        )}
      </div>
      {plugin.documentProvider && (
        <BundledProviderAction
          name={plugin.documentProvider}
          label={plugin.name.replace(/^Microsoft /, "")}
        />
      )}
      <PluginAction {...props} />
      <DropdownMenu
        align="end"
        label={`${plugin.name} options`}
        trigger={
          <Button
            size="icon-sm"
            variant="ghost"
            class="text-muted-foreground"
            aria-label={`More about ${plugin.name}`}
            disabled={busy !== null}
          >
            <Icon name="dots-three" />
          </Button>
        }
      >
        {plugin.homepage && (
          <DropdownMenuItem onClick={() => void openLink(plugin.homepage)}>
            <Icon name="arrow-square-out" class="mr-2 text-xs" />
            Website
          </DropdownMenuItem>
        )}
        {plugin.terms && (
          <DropdownMenuItem onClick={() => void openLink(plugin.terms)}>
            <Icon name="file-text" class="mr-2 text-xs" />
            {plugin.localApp ? "License / terms" : "Terms of use"}
          </DropdownMenuItem>
        )}
        {plugin.enabled && (
          <DropdownMenuItem class="text-destructive" onClick={() => onEnabled(false)}>
            <Icon name="trash" class="mr-2 text-xs" />
            {plugin.auth === "oauth" ? "Remove and sign out" : "Remove"}
          </DropdownMenuItem>
        )}
      </DropdownMenu>
    </div>
  );
}
