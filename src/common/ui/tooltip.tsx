import { cn } from "@/common/utils";
import { shortcutLabel, type KeybindingId } from "@/keybindings/data/keybindings";
import { useKeybindingPreferences } from "@/keybindings/hooks/use-keybinding-preferences";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

interface TooltipProps {
  content: string;
  /** Show the current assigned shortcut, never a hard-coded default. */
  shortcut?: KeybindingId;
  children: ComponentChildren;
  side?: "top" | "bottom" | "left" | "right";
  /** Extra classes for the trigger wrapper (e.g. "flex w-full" around a list row). */
  class?: string;
}

const OPEN_DELAY_MS = 350;

function TooltipText({ content, shortcut }: Pick<TooltipProps, "content" | "shortcut">) {
  useKeybindingPreferences();
  return <>{shortcutLabel(content, shortcut)}</>;
}

interface Rect {
  top: number;
  left: number;
}

/**
 * Tooltip with portal to document.body + position:fixed.
 *
 * Reason: inside overflow-hidden containers (sidebar, panels), an absolute
 * tooltip gets clipped at the panel edge. With portal+fixed the tooltip
 * floats above everything, regardless of ancestor overflow. It also closes
 * on click (doesn't persist after clicking the trigger).
 */
export function Tooltip({
  content,
  shortcut,
  children,
  side = "top",
  class: className,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Rect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const r = wrap.getBoundingClientRect();
    const midX = r.left + r.width / 2;
    const midY = r.top + r.height / 2;
    let rect: Rect | null = null;
    if (side === "right") {
      rect = { left: r.right + 6, top: midY };
    } else if (side === "left") {
      rect = { left: r.left - 6, top: midY };
    } else if (side === "bottom") {
      rect = { left: midX, top: r.bottom + 6 };
    } else {
      rect = { left: midX, top: r.top - 6 };
    } // top
    const tip = tipRef.current;
    if (tip) {
      const { width, height } = tip.getBoundingClientRect();
      const offsetX = side === "left" ? width : side === "right" ? 0 : width / 2;
      const offsetY = side === "top" ? height : side === "bottom" ? 0 : height / 2;
      rect.left =
        Math.max(8, Math.min(rect.left - offsetX, window.innerWidth - width - 8)) + offsetX;
      rect.top =
        Math.max(8, Math.min(rect.top - offsetY, window.innerHeight - height - 8)) + offsetY;
    }
    setPos((prev) => (prev?.left === rect.left && prev?.top === rect.top ? prev : rect));
  }, [side]);

  // Short open delay so tooltips don't flash while the pointer travels across
  // a toolbar; closing is immediate.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openTip = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      place();
      setOpen(true);
    }, OPEN_DELAY_MS);
  }, [place]);
  const closeTip = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeTip);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeTip);
    };
  }, [open, place, closeTip]);

  useLayoutEffect(() => {
    if (!open || !tipRef.current) {
      return;
    }
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(tipRef.current);
    return () => observer?.disconnect();
  }, [open, place]);

  // CSS anchor per side: translate to center relative to the anchor point
  const anchorClass: Record<string, string> = {
    top: "-translate-x-1/2 -translate-y-full",
    bottom: "-translate-x-1/2",
    left: "-translate-x-full -translate-y-1/2",
    right: "-translate-y-1/2",
  };

  return (
    <div
      ref={wrapRef}
      class={cn("relative inline-flex", className)}
      onMouseEnter={openTip}
      onMouseLeave={closeTip}
      onClick={closeTip}
      onFocusCapture={openTip}
      onBlurCapture={closeTip}
    >
      {children}
      {open &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            ref={tipRef}
            // Portaled content inherits the global appearance tokens.
            class={cn(
              "fixed z-50 rounded bg-secondary px-2 py-1 text-[11px] text-foreground border border-border shadow-md w-max max-w-[calc(100vw-16px)] whitespace-normal break-words pointer-events-none",
              anchorClass[side],
            )}
            style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
          >
            <TooltipText content={content} shortcut={shortcut} />
          </div>,
          document.body,
        )}
    </div>
  );
}
