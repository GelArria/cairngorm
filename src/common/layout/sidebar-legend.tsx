// Sidebar v2 section header: label on a hairline, count (or an action) at the end.
// With `onAdd`, a discreet "+" takes the count's place while the header is
// hovered or keyboard-focused. It stays in layout (opacity, not display) so Tab
// reaches it; count and "+" share one grid cell, so nothing shifts.
import { PlusIcon } from "@/common/ui/animated-icon";
import { Button } from "@/common/ui/button";
import { Tooltip } from "@/common/ui/tooltip";
import type { ComponentChildren } from "preact";

interface Props {
  label: string;
  count?: number;
  /** Trailing control (e.g. "stage all") — replaces the count. */
  action?: ComponentChildren;
  /** Create something in this section (shown as "+" on hover / focus). */
  onAdd?: () => void;
  addLabel?: string;
  class?: string;
}

export function SidebarLegend({
  label,
  count,
  action,
  onAdd,
  addLabel = "New",
  class: className = "",
}: Props) {
  const countEl = count !== undefined && (
    <span class="tabular-nums text-muted-foreground/70">{count}</span>
  );
  return (
    <div
      class={`group flex items-center gap-2 px-3.5 pb-1.5 pt-3 text-[11px] text-muted-foreground ${className}`}
    >
      <span class="truncate">{label}</span>
      <i class="h-px flex-1 bg-border" />
      {action ??
        (onAdd ? (
          <span class="grid">
            <span class="col-start-1 row-start-1 justify-self-end transition-opacity group-hover:opacity-0 group-has-[:focus-visible]:opacity-0">
              {countEl}
            </span>
            <Tooltip
              content={addLabel}
              side="right"
              class="col-start-1 row-start-1 justify-self-end opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
            >
              <Button
                variant="subtle"
                size="icon-xs"
                class="-mr-1 -my-1 text-xs"
                aria-label={addLabel}
                data-testid={`legend-add-${label.toLowerCase()}`}
                onClick={onAdd}
              >
                <PlusIcon />
              </Button>
            </Tooltip>
          </span>
        ) : (
          countEl
        ))}
    </div>
  );
}
