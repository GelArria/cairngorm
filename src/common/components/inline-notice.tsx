// Inline error / warning row: tinted hairline box, icon, selectable message and
// an optional dismiss. Replaces bare red text for runtime failures.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";

interface Props {
  message: string;
  tone?: "error" | "warning";
  onDismiss?: () => void;
  class?: string;
  "data-testid"?: string;
}

const TONE = {
  error: "border-red-500/25 bg-red-500/10 text-red-300",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
};

export function InlineNotice({
  message,
  tone = "error",
  onDismiss,
  class: className,
  ...rest
}: Props) {
  return (
    <div
      role="alert"
      data-testid={rest["data-testid"]}
      class={cn(
        "flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug",
        TONE[tone],
        className,
      )}
    >
      <Icon name={tone === "error" ? "warning-circle" : "warning"} class="mt-px shrink-0 text-xs" />
      <span class="min-w-0 flex-1 select-text break-words">{message}</span>
      {onDismiss && (
        <Button
          variant="subtle"
          size="icon-xs"
          class="-my-0.5 -mr-1 text-inherit"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon name="x" />
        </Button>
      )}
    </div>
  );
}
