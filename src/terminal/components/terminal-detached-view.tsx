import { CairngormLoader } from "@/common/branding/";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { WindowControls } from "@/common/ui/window-controls";
import { useDetachedTerminalView } from "@/terminal/hooks/use-detached-terminal-view";
import { DetachedTerminalViewProps } from "@/terminal/model/terminal-detached-view";
import { TerminalTabs } from "./terminal-tabs";

/**
 * Detached window = fully-featured terminal: tab bar, all 4 splits,
 * drag&drop (move to gap / swap), resize, zoom and "+" shells.
 * The store is a singleton per webview — it hydrates from the URL payload and
 * from there on it is a normal TerminalTabs (embedded prop).
 */
export function DetachedTerminalView({ group }: DetachedTerminalViewProps) {
  const { ready, platform, macos, inlineTabs, handleReattach, title } = useDetachedTerminalView({
    group,
  });

  return (
    // Every window inherits the appearance store tokens from <html>.
    <div class="surface-base flex flex-col h-screen bg-background text-foreground">
      {/* Header identical to attached ChatView ("Agent"): same padding,
          border, typography and button container — the detached window feels the same. */}
      <div
        data-tauri-drag-region
        class={`flex h-[38px] items-center border-b border-border bg-card surface-header px-3 shrink-0 ${macos ? "justify-start" : "justify-between"}`}
      >
        {macos && <WindowControls platform={platform} />}
        <h1
          data-tauri-drag-region
          class="text-[13px] font-semibold flex items-center gap-1.5 min-w-0"
        >
          <Icon name="arrow-square-out" class="text-sm text-sky-400/80 shrink-0" />
          <span data-tauri-drag-region class="truncate">
            {title}
          </span>
          {inlineTabs.length > 1 && (
            <span class="text-[10px] font-normal text-muted-foreground/50 shrink-0">
              +{inlineTabs.length - 1}
            </span>
          )}
        </h1>
        <div class={`flex items-center gap-1 ${macos ? "ml-auto" : ""}`}>
          <Tooltip content="Reattach to main window" shortcut="reattach" side="left">
            <Button
              size="xs"
              class="gap-1.5"
              data-tauri-no-drag-region
              onClick={handleReattach}
              aria-label="Reattach"
            >
              <Icon name="plug" />
              <span>Reattach</span>
            </Button>
          </Tooltip>
          {!macos && <WindowControls platform={platform} />}
        </div>
      </div>
      {ready ? (
        <TerminalTabs embedded />
      ) : (
        <div class="surface-panel flex-1 min-h-0">
          <CairngormLoader label="Restoring terminals..." />
        </div>
      )}
    </div>
  );
}
