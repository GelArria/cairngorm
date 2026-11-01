// The ONE sidebar show/hide control. Same cell, same spot (bottom outer
// corner, 44px wide — the collapsed rail's width) in both states, so the » / «
// never jumps. Mirrored when the sidebar sits on the right.
import { ChevronsIcon } from "@/common/ui/animated-icon";
import { Tooltip } from "@/common/ui/tooltip";
import { innerSide, type SidebarSide } from "../../common/layout/sidebar-side";

interface Props {
  side: SidebarSide;
  collapsed: boolean;
  onToggle: () => void;
  /** Inside the footer's inset bar: 32px, centred where the rail's 44px cell is. */
  compact?: boolean;
}

export function SidebarToggle({ side, collapsed, onToggle, compact = false }: Props) {
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  const inner = innerSide(side);
  return (
    <Tooltip content={label} side={inner} class="flex h-full">
      <button
        data-testid={collapsed ? "sidebar-expand" : "sidebar-collapse"}
        aria-label={label}
        class={`group flex h-full shrink-0 items-center justify-center text-sm text-muted-foreground outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
          compact
            ? "w-8 rounded-md"
            : `w-11 ${collapsed ? "" : side === "left" ? "border-r border-border" : "border-l border-border"}`
        }`}
        onClick={onToggle}
      >
        {/* Points where the sidebar will go: out when hiding, in when showing */}
        <ChevronsIcon
          dir={
            collapsed ? (side === "left" ? "right" : "left") : side === "right" ? "right" : "left"
          }
        />
      </button>
    </Tooltip>
  );
}
