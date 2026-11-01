// A manual native-agent failure must remain visible even with other panes open.
import { openSettings } from "@/common/events/app-events";
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { describeAgentError } from "../runtime/launch-actions";

interface Props {
  error: string;
  onRetry: () => void;
  onDismiss: () => void;
}

export function AgentLaunchNotice({ error, onRetry, onDismiss }: Props) {
  const problem = describeAgentError(error);
  return (
    <div
      role="alert"
      class="relative rounded-lg border border-red-400/25 bg-red-400/[0.06] p-3 font-sans"
      data-testid="agent-problem"
    >
      <Button
        variant="subtle"
        size="icon-xs"
        class="absolute right-2 top-2"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <Icon name="x" />
      </Button>
      <p class="pr-6 text-xs font-medium text-foreground">{problem.title}</p>
      <p class="mt-1 text-[11px] leading-snug text-muted-foreground">{problem.body}</p>
      <div class="mt-2.5 flex gap-1.5">
        {problem.fix === "settings" && (
          <Button size="xs" onClick={() => openSettings()}>
            Open Settings
          </Button>
        )}
        <Button
          variant={problem.fix === "settings" ? "ghost" : "outline"}
          size="xs"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
      <details class="mt-2 text-[10.5px] text-muted-foreground">
        <summary class="cursor-pointer select-none">Details</summary>
        <pre class="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono">
          {error}
        </pre>
      </details>
    </div>
  );
}
