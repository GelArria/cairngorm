import { Badge } from "@/common/ui/badge";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { usePluginCall } from "@/plugins/hooks/use-plugin-call";
import { markPluginRecovered } from "./data/plugin-store";
import type { PluginViewControls } from "./hooks/use-plugin-view";
import { useEffect, useState } from "preact/hooks";
import { PluginView } from "./components/plugin-view";
import type { PluginCallState } from "./model/types";

const STATUS = {
  running: { label: "Working", icon: "spinner", tone: "bg-muted text-foreground" },
  done: {
    label: "Done",
    icon: "check-circle",
    tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  failed: { label: "Failed", icon: "warning-circle", tone: "bg-destructive/10 text-destructive" },
} as const;

function useElapsed(state: PluginCallState | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state?.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state?.status]);
  return state ? Math.max(0, (now - state.startedAt) / 1000) : 0;
}

/** Live view of the latest plugin call made from the source terminal. */
export function PluginPane({
  callId,
  pluginId,
  sourceTitle,
  onShowTerminal,
}: {
  callId?: string;
  pluginId: string;
  sourceTitle: string;
  onShowTerminal: () => void;
}) {
  const state = usePluginCall(callId);
  const pluginName = state?.call.pluginName ?? pluginId;
  const [reload, setReload] = useState(0);
  const [controls, setControls] = useState<PluginViewControls | null>(null);
  const needsRecovery = state?.status === "failed" && pluginId === "tldraw" && !state.recovered;
  const reloadLabel = needsRecovery ? "Recover last saved view" : "Reload view";
  const elapsed = useElapsed(state);
  const status = state?.recovered
    ? { ...STATUS.done, label: "Recovered" }
    : state
      ? STATUS[state.status]
      : null;
  const toolName = state?.call.tool.title ?? state?.call.tool.name;
  return (
    <section
      class="flex h-full min-h-0 min-w-0 flex-col"
      aria-label={`${pluginName} view`}
      data-testid="plugin-pane"
    >
      <header class="flex min-w-0 shrink-0 items-center gap-x-3 border-b border-border/70 bg-card surface-strip-panel px-3 py-2">
        <div class="flex min-w-0 items-center gap-2" title={`${pluginName} · ${sourceTitle}`}>
          {state?.call.pluginLogo ? (
            <img
              src={state.call.pluginLogo}
              alt=""
              aria-hidden="true"
              class="size-4 shrink-0 rounded-[4px] ring-1 ring-border"
            />
          ) : (
            <Icon name="plug" class="text-xs text-muted-foreground" />
          )}
          <h2 class="truncate text-sm font-semibold">{pluginName}</h2>
          {status && (
            <span role="status">
              <Badge variant="muted" class={`gap-1.5 text-[11px] ${status.tone}`}>
                <Icon
                  name={status.icon}
                  class={
                    state?.status === "running" ? "text-xs motion-safe:animate-spin" : "text-xs"
                  }
                />
                {status.label}
              </Badge>
            </span>
          )}
          {state?.call.agent?.name && (
            <span class="shrink-0 text-[11px] text-muted-foreground" data-testid="plugin-agent">
              via {state.call.agent.name}
            </span>
          )}
          {toolName && (
            <span class="truncate font-mono text-[11px] text-muted-foreground">{toolName}</span>
          )}
          {state && (
            <span class="font-mono text-[11px] tabular-nums text-muted-foreground">
              {elapsed.toFixed(1)}s
            </span>
          )}
        </div>
        <div class="ml-auto flex items-center gap-1">
          <Tooltip content={reloadLabel} side="bottom">
            <Button
              variant="subtle"
              size="icon-sm"
              aria-label={reloadLabel}
              disabled={
                !state || state.status === "running" || !controls?.ready || controls.preparingReload
              }
              onClick={async () => {
                if (await controls?.prepareReload()) {
                  if (needsRecovery && state) {
                    markPluginRecovered(state.call.id);
                  }
                  setReload((n) => n + 1);
                }
              }}
            >
              <Icon name="arrow-clockwise" class="text-xs" />
            </Button>
          </Tooltip>
          <Tooltip content="Return to terminal" side="bottom">
            <Button variant="subtle" size="icon-sm" aria-label="Terminal" onClick={onShowTerminal}>
              <Icon name="terminal" class="text-xs" />
            </Button>
          </Tooltip>
        </div>
      </header>
      {state?.error && (
        <p
          role="alert"
          class="shrink-0 border-b border-border/70 bg-destructive/5 px-3 py-1.5 text-xs text-destructive"
        >
          {state.error}
        </p>
      )}
      {needsRecovery && (
        <p class="shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground">
          Recovery restores the last acknowledged checkpoint, not unsaved partial edits.
        </p>
      )}
      {state ? (
        <PluginView key={`${state.call.id}-${reload}`} state={state} onControls={setControls} />
      ) : (
        <div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          The view appears when an agent in {sourceTitle} uses {pluginName}.
        </div>
      )}
    </section>
  );
}
