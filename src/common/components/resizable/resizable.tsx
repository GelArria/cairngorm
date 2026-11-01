import { useCallback, useState } from "preact/hooks";
import { foldProgress, isArmed } from "./fold";
import { useFoldDrag } from "./use-fold-drag";

interface ResizableProps {
  side: "left" | "right";
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  collapsedWidth?: number;
  collapsed?: boolean;
  /** Horizontal navigation fills the window without a width resize handle. */
  fullWidth?: boolean;
  onDoubleClick?: () => void;
  /** Enables folding: dragging past the minimum width collapses on release. */
  onCollapse?: () => void;
  /** Enables unfolding: dragging the collapsed rail's edge outward expands it. */
  onExpand?: () => void;
  /** Colour of the edge while folding (CSS `--fold-accent`). */
  accent?: string;
  class?: string;
  children: preact.ComponentChild;
}

const EASE = "cubic-bezier(.2,.8,.2,1)";

export function Resizable({
  side,
  defaultWidth,
  minWidth = 160,
  maxWidth = 500,
  collapsedWidth = 44,
  collapsed = false,
  fullWidth = false,
  onDoubleClick,
  onCollapse,
  onExpand,
  accent,
  class: cls,
  children,
}: ResizableProps) {
  const [width, setWidth] = useState(defaultWidth);
  const limits = { minWidth, collapsedWidth };

  const getClampedWidth = useCallback(
    (w: number) => {
      const limit = Math.min(maxWidth, window.innerWidth - 300);
      return Math.max(minWidth, Math.min(limit, isNaN(w) ? defaultWidth : w));
    },
    [minWidth, maxWidth, defaultWidth],
  );

  const { drag, start } = useFoldDrag({
    side,
    width,
    setWidth,
    limits,
    collapsed,
    clamp: getClampedWidth,
    onCollapse,
    onExpand,
    resetKey: `${side}:${fullWidth}`,
  });

  const folding = drag && drag.mode !== "resize" ? drag : null;
  const progress = folding ? foldProgress(folding, limits) : 0;
  const armed = folding ? isArmed(folding, limits) : false;
  const currentWidth = drag ? drag.width : collapsed ? collapsedWidth : getClampedWidth(width);
  const showHandle = !fullWidth && (!collapsed || !!onExpand);
  const transition = drag
    ? "none"
    : `width 250ms ${EASE}, min-width 250ms ${EASE}, max-width 250ms ${EASE}`;
  return (
    <div
      class={`relative flex ${cls ?? ""}`}
      data-fold={folding?.mode}
      data-armed={armed ? "" : undefined}
      data-side={side}
      style={
        fullWidth
          ? { width: "100%", flexShrink: 0 }
          : {
              width: currentWidth,
              minWidth: currentWidth,
              maxWidth: currentWidth,
              flexShrink: 0,
              overflow: "hidden",
              transition,
              "--fold": progress.toFixed(3),
              "--fold-min": `${minWidth}px`,
              ...(accent ? { "--fold-accent": accent } : {}),
            }
      }
    >
      {/* Stable child position preserves mounted panels when changing edges. */}
      <div class={`fold-content flex-1 min-w-0 ${fullWidth ? "" : "overflow-hidden"}`}>
        {children}
      </div>
      {showHandle && (
        <div
          // On the rail the edge overlays it: the rail keeps its full width.
          class={`fold-handle ${collapsed ? `absolute inset-y-0 z-10 ${side === "right" ? "left-0" : "right-0"}` : "relative"} shrink-0 w-[3px] h-full cursor-col-resize group flex items-center justify-center hover:bg-primary/60 active:bg-primary transition-colors bg-transparent ${side === "right" ? "order-first" : ""}`}
          onMouseDown={start}
          onDblClick={onDoubleClick}
        >
          <div class="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-0.5">
            <div class="w-1 h-0.5 rounded-full bg-foreground/40" />
            <div class="w-1 h-0.5 rounded-full bg-foreground/40" />
            <div class="w-1 h-0.5 rounded-full bg-foreground/40" />
          </div>
        </div>
      )}
    </div>
  );
}
