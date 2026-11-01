import { Icon } from "@/common/ui/icon";
import { usePluginView, type PluginViewControls } from "@/plugins/hooks/use-plugin-view";
import { useEffect } from "preact/hooks";
import type { PluginCallState } from "../model/types";

// The view's own origin isolates it from the app; same-origin is within that origin only.
const SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";

/** One view instance per tool call: MCP Apps deliver a call's input exactly once. */
export function PluginView({
  state,
  onControls,
}: {
  state: PluginCallState;
  onControls?: (controls: PluginViewControls | null) => void;
}) {
  const { container, frame, ready, call, clipboard, preparingReload, reloadError, prepareReload } =
    usePluginView({ state });
  useEffect(() => {
    onControls?.({ ready, preparingReload, prepareReload });
  }, [onControls, ready, preparingReload, prepareReload]);
  useEffect(() => () => onControls?.(null), [onControls]);

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      {reloadError && (
        <p
          role="alert"
          class="shrink-0 break-words border-b border-border bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {reloadError}
        </p>
      )}
      <div
        ref={container}
        class="surface-base relative min-h-0 flex-1 bg-background"
        aria-busy={preparingReload}
      >
        <iframe
          ref={frame}
          title={`${call.pluginName} view`}
          class="absolute inset-0 h-full w-full border-0"
          // A mismatched color-scheme makes Chromium paint an opaque white backdrop behind
          // cross-origin views; space a view leaves uncovered shows the pane instead.
          style={{ colorScheme: "normal" }}
          sandbox={SANDBOX}
          allow={clipboard}
          referrerpolicy="no-referrer"
          data-testid="plugin-view-frame"
        />
        {preparingReload && (
          <div
            role="status"
            class="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-xs"
          >
            <Icon name="spinner-gap" class="motion-safe:animate-spin" />
            Saving view…
          </div>
        )}
        {!ready && (
          <div
            role="status"
            class="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-background text-xs text-muted-foreground"
          >
            <Icon name="spinner-gap" class="motion-safe:animate-spin" />
            Loading {call.pluginName}…
          </div>
        )}
      </div>
    </div>
  );
}
