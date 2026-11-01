// Shared empty state: muted icon over one short line, an optional hint and action.
// Sidebar panels (Git, Files, Agenda, Terminals, Calendar) all show "nothing here" the
// same way, centered in whatever room their panel gives them.
import { Icon, type IconName } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import type { ComponentChildren } from "preact";

interface Props {
  icon?: IconName;
  text: string;
  /** A second, quieter line under the text. */
  description?: string;
  /** Expose the text as a heading, so assistive tech can jump to it. */
  heading?: boolean;
  children?: ComponentChildren;
  class?: string;
  "data-testid"?: string;
}

export function EmptyState({
  icon,
  text,
  description,
  heading = false,
  children,
  class: className,
  "data-testid": testId,
}: Props) {
  return (
    <div
      data-testid={testId}
      class={cn(
        "flex flex-1 flex-col items-center justify-center gap-2 px-9 pb-12 text-center",
        className,
      )}
    >
      {icon && <Icon name={icon} strokeWidth={1.5} class="text-[28px] text-muted-foreground/60" />}
      <span
        class="text-xs text-muted-foreground"
        role={heading ? "heading" : undefined}
        aria-level={heading ? 3 : undefined}
      >
        {text}
      </span>
      {description && (
        <span class="-mt-1 max-w-[220px] text-[11px] leading-snug text-muted-foreground/80">
          {description}
        </span>
      )}
      {children}
    </div>
  );
}
