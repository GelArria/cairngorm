import { Icon } from "@/common/ui/icon";
import type { BrowserStream } from "../data/browser-store";

export function TestPaneFooter({
  stream,
  sourceTitle,
  command,
  output,
}: {
  stream?: BrowserStream;
  sourceTitle: string;
  command?: string;
  output: boolean;
}) {
  const label = stream?.testName || stream?.title || sourceTitle;
  return (
    <footer
      data-testid="test-pane-footer"
      class="flex h-[30px] min-w-0 shrink-0 items-center gap-2 border-t border-border/70 bg-card/60 px-3 font-mono text-[10px] text-muted-foreground"
    >
      <Icon name={stream ? "file-code" : "terminal"} class="text-xs" />
      <span class="min-w-0 truncate" title={stream ? label : command || sourceTitle}>
        {label}
      </span>
      {stream?.width && (
        <span
          class="shrink-0 border-l border-border pl-2 tabular-nums"
          title="Test controls the browser"
        >
          {stream.width} × {stream.height}
          <span class="sr-only"> · Test controls the browser</span>
        </span>
      )}
      {output && (
        <span
          class="shrink-0 border-l border-border pl-2"
          title="Full output remains in the terminal"
        >
          Latest 600 lines
        </span>
      )}
    </footer>
  );
}
