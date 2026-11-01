import { cn } from "@/common/utils";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { DropdownContext } from "./dropdown-menu-item";

export {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./dropdown-menu-item";

interface DropdownMenuProps {
  trigger: ComponentChildren;
  children: ComponentChildren;
  align?: "start" | "end";
  direction?: "down" | "up";
  class?: string;
  /** Project pickers host dialogs: keep their backdrop below the dialog overlay. */
  belowDialogs?: boolean;
  /** Controlled mode: the owner decides whether a trigger click opens the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible name of the menu panel. */
  label?: string;
}

export function DropdownMenu({
  trigger,
  children,
  align = "start",
  direction = "down",
  belowDialogs = false,
  class: className,
  open: controlledOpen,
  onOpenChange,
  label,
}: DropdownMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    bottom: number;
    right: number;
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (belowDialogs && document.querySelector('[role="dialog"]'))) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, belowDialogs]);

  // layout effect: position before paint (no first frame at the wrong spot)
  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom, left: rect.left, bottom: rect.top, right: rect.right });
    }
  }, [open]);

  // Keep the open menu inside the window (8px margin). Runs once the anchor
  // position is known, and measures WITHOUT the previous shift applied.
  useLayoutEffect(() => {
    const zero = (s: { x: number; y: number }) => (s.x || s.y ? { x: 0, y: 0 } : s);
    if (!open || !pos || !menuRef.current) {
      setShift(zero);
      return;
    }
    const raw = menuRef.current.getBoundingClientRect();
    const r = {
      left: raw.left - shift.x,
      right: raw.right - shift.x,
      top: raw.top - shift.y,
      bottom: raw.bottom - shift.y,
    };
    const x =
      r.right > window.innerWidth - 8
        ? window.innerWidth - 8 - r.right
        : r.left < 8
          ? 8 - r.left
          : 0;
    const y =
      r.bottom > window.innerHeight - 8
        ? window.innerHeight - 8 - r.bottom
        : r.top < 8
          ? 8 - r.top
          : 0;
    setShift((s) => (s.x === x && s.y === y ? s : { x, y }));
  }, [open, pos]);

  return (
    <DropdownContext.Provider value={{ close }}>
      <div class={cn("relative inline-flex", className)}>
        <div ref={triggerRef} onClick={() => setOpen(!open)}>
          {trigger}
        </div>
        {/* Portaled: the backdrop and items must not live inside the trigger's
            ancestors (a draggable card would start drags / get context menus
            from clicks anywhere on screen). `dark`: outside the App theme root. */}
        {open &&
          createPortal(
            <div>
              <div class={`fixed inset-0 ${belowDialogs ? "z-[50]" : "z-[70]"}`} onClick={close} />
              <div
                ref={menuRef}
                role="menu"
                aria-label={label}
                class={`fixed min-w-[160px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md ${belowDialogs ? "z-[51]" : "z-[71]"}`}
                style={{
                  ...(direction === "up"
                    ? { bottom: window.innerHeight - (pos?.bottom ?? 0) + 4 }
                    : { top: (pos?.top ?? 0) + 4 }),
                  // "end": right edges line up (menus opened from right-aligned triggers)
                  ...(align === "end"
                    ? { right: window.innerWidth - (pos?.right ?? 0) }
                    : { left: pos?.left }),
                  transform:
                    shift.x || shift.y ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
                }}
              >
                {children}
              </div>
            </div>,
            document.body,
          )}
      </div>
    </DropdownContext.Provider>
  );
}
