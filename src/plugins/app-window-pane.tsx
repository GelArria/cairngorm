// A pane showing an installed application's own window (Excel, Word…) that an agent drove.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { useEffect, useRef } from "preact/hooks";
import { useAppWindowDock } from "./hooks/use-app-window-dock";

export function AppWindowPane({
  hwnd,
  appId,
  appName,
  sourceTitle,
  onShowTerminal,
  onReopened,
}: {
  hwnd: string;
  appId: string;
  appName: string;
  sourceTitle: string;
  onShowTerminal: () => void;
  onReopened: (hwnd: string) => void;
}) {
  const { area, error, released, closed, opening, release, attach, reopen } = useAppWindowDock(
    hwnd,
    appId,
    onReopened,
  );
  // Opened from the "+" menu without a window yet: the pane launches the application itself,
  // so progress and errors stay visible here and a second click reuses this pane.
  const launched = useRef(false);
  useEffect(() => {
    if (!hwnd && !launched.current) {
      launched.current = true;
      void reopen();
    }
  }, [hwnd]);
  const pending = !hwnd;
  return (
    <div class="flex h-full flex-col" data-testid="app-window-pane">
      <header class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <Icon name="layout" class="text-muted-foreground" />
        <span class="font-medium text-foreground">{appName}</span>
        <span class="truncate text-muted-foreground">· driven from {sourceTitle}</span>
        <div class="ml-auto flex shrink-0 gap-1">
          <Button size="xs" variant="ghost" onClick={onShowTerminal}>
            <Icon name="terminal" class="mr-1" />
            Terminal
          </Button>
          {closed ? null : released ? (
            <Button size="xs" variant="ghost" onClick={attach}>
              Show here
            </Button>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              onClick={release}
              title="Give the window its own frame back"
            >
              <Icon name="arrow-square-out" class="mr-1" />
              Open as window
            </Button>
          )}
        </div>
      </header>
      <div ref={area} class="relative min-h-0 flex-1 bg-muted/20">
        {(closed || released || error || pending) && (
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
            <p role={error ? "alert" : "status"}>
              {error ||
                (pending
                  ? `Opening ${appName}…`
                  : closed
                    ? `${appName} was closed.`
                    : `${appName} is open in its own window.`)}
            </p>
            {closed || (pending && error) ? (
              <Button size="xs" variant="outline" onClick={reopen} disabled={opening}>
                {opening ? "Opening…" : pending ? "Try again" : `Reopen ${appName}`}
              </Button>
            ) : (
              released && (
                <Button size="xs" variant="outline" onClick={attach}>
                  Show it here
                </Button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
