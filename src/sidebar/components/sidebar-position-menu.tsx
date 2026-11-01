import { DropdownMenu, DropdownMenuItem } from "@/common/ui/dropdown-menu";
import type { ComponentChildren } from "preact";
import { SIDEBAR_POSITIONS, type SidebarSide } from "../../common/layout/sidebar-side";

const EDGE: Record<SidebarSide, string> = {
  left: "left-0 top-0 h-full w-[28%] border-r",
  right: "right-0 top-0 h-full w-[28%] border-l",
  top: "left-0 top-0 h-[24%] w-full border-b",
  bottom: "bottom-0 left-0 h-[24%] w-full border-t",
};

/** Four spatial previews: selecting a tile commits, opening the menu never moves the app. */
export function SidebarPositionMenu({
  side,
  onSelect,
  trigger,
  direction = "down",
  align = "end",
}: {
  side: SidebarSide;
  onSelect: (side: SidebarSide) => void;
  trigger: ComponentChildren;
  direction?: "down" | "up";
  /** "start" opens rightward (a left-side trigger), "end" leftward. */
  align?: "start" | "end";
}) {
  return (
    <DropdownMenu align={align} direction={direction} trigger={trigger}>
      <div class="w-[280px] max-w-[calc(100vw-24px)] p-2" data-testid="sidebar-position-menu">
        <div class="mb-3 px-1">
          <div class="text-xs font-medium">Navigation position</div>
          <p class="mt-1 text-[11px] text-muted-foreground">Choose an edge for your workspace.</p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          {SIDEBAR_POSITIONS.map(({ side: edge, label }) => (
            <DropdownMenuItem
              key={edge}
              checked={side === edge}
              onClick={() => onSelect(edge)}
              class={`group relative flex-col items-stretch gap-2 border p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${side === edge ? "border-ring [&>span:last-child]:absolute [&>span:last-child]:bottom-2 [&>span:last-child]:right-2" : "border-border"}`}
            >
              <div
                aria-hidden="true"
                class="overflow-hidden rounded border border-border bg-background"
              >
                <div class="flex h-3 items-center gap-0.5 border-b border-border bg-card px-1">
                  <span class="h-1 w-1 rounded-full bg-muted-foreground/50" />
                  <span class="h-1 w-1 rounded-full bg-muted-foreground/30" />
                </div>
                <div class="relative h-[62px]">
                  <div class="absolute left-[35%] top-[35%] h-1 w-[38%] rounded-sm bg-muted-foreground/20" />
                  <div class="absolute left-[35%] top-[49%] h-1 w-[25%] rounded-sm bg-muted-foreground/10" />
                  <div
                    class={`absolute flex items-center justify-center gap-1 border-ring/40 bg-primary/20 ${EDGE[edge]} ${edge === "left" || edge === "right" ? "flex-col" : "flex-row"}`}
                  >
                    {[0, 1, 2].map((n) => (
                      <span key={n} class="h-1.5 w-1.5 rounded-sm bg-primary/60" />
                    ))}
                  </div>
                </div>
              </div>
              <span class="text-[11px] font-medium">{label}</span>
            </DropdownMenuItem>
          ))}
        </div>
        <p class="mt-3 px-1 text-[11px] text-muted-foreground">Top & bottom use a compact dock.</p>
      </div>
    </DropdownMenu>
  );
}
