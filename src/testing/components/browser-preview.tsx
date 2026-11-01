import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Input } from "@/common/ui/input";
import { Tooltip } from "@/common/ui/tooltip";
import { useEffect, useState } from "preact/hooks";
import { useBrowserPreview } from "../hooks/use-browser-preview";

export function BrowserPreview({
  initialUrl,
  onLive,
}: {
  initialUrl?: string;
  onLive: () => void;
}) {
  const { surface, state, available, navigate, control } = useBrowserPreview();
  const [address, setAddress] = useState(
    initialUrl?.startsWith("http") ? initialUrl : "http://localhost:3000",
  );
  useEffect(() => {
    if (state.url) {
      setAddress(state.url);
    }
  }, [state.url]);
  return (
    <section
      class="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label="Browser preview"
      data-testid="browser-preview"
    >
      <form
        class="flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-card/40 px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate(address);
        }}
      >
        {(["back", "forward", "reload"] as const).map((action) => (
          <Tooltip
            key={action}
            content={
              action === "reload" ? "Reload page" : action === "back" ? "Go back" : "Go forward"
            }
          >
            <Button
              type="button"
              size="icon-sm"
              variant="subtle"
              disabled={!state.opened}
              aria-label={
                action === "reload"
                  ? "Reload preview"
                  : action === "back"
                    ? "Back in preview"
                    : "Forward in preview"
              }
              onClick={() => control(action)}
            >
              <Icon
                name={
                  action === "reload"
                    ? "arrow-clockwise"
                    : action === "back"
                      ? "caret-left"
                      : "caret-right"
                }
              />
            </Button>
          </Tooltip>
        ))}
        <Input
          class="h-7 min-w-0 flex-1 font-mono text-[11px]"
          aria-label="Browser address"
          spellcheck={false}
          value={address}
          onInput={(event) => setAddress(event.currentTarget.value)}
          disabled={!available}
        />
        <Button type="submit" size="xs" variant="secondary" disabled={!available || state.loading}>
          {state.loading ? (
            <>
              <Icon name="spinner" class="motion-safe:animate-spin" />
              <span class="sr-only">Loading page</span>
            </>
          ) : (
            "Go"
          )}
        </Button>
        <Button type="button" size="xs" variant="subtle" onClick={onLive}>
          Live tests
        </Button>
      </form>
      {state.error && (
        <p class="shrink-0 border-b border-border px-3 py-2 text-xs text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <div
        ref={surface}
        class="relative min-h-0 flex-1 bg-muted/20"
        data-testid="browser-preview-surface"
      >
        {!state.opened && (
          <div class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Icon name="terminal-window" class="text-2xl text-muted-foreground" />
            <p class="text-xs font-medium">
              {available
                ? "Open your app in the browser"
                : "Browser preview is available in the desktop app"}
            </p>
            <p class="max-w-sm text-[11px] leading-5 text-muted-foreground">
              {available
                ? "Enter your app's address and press Go. This preview has its own session; live tests show the pages controlled by your test runner."
                : "Use Live tests to follow your test runner's pages here."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
