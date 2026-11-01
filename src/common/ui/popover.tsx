// Popover: a non-modal panel anchored to a trigger (shadcn's Popover role), for
// content that is not a list of menu items — a grid of cards, a form. Focus moves
// in on open, Tab stays inside, Escape or an outside click closes and focus
// returns to the trigger.
import { cn } from "@/common/utils";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface PopoverTriggerProps {
  "aria-haspopup": "dialog";
  "aria-expanded": boolean;
  onClick: () => void;
}

interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Spread the given props on the trigger button. */
  trigger: (props: PopoverTriggerProps) => ComponentChildren;
  /** Accessible name of the panel. */
  label: string;
  children: ComponentChildren;
  /** Below dialogs opened from inside the panel (rename, appearance…). */
  belowDialogs?: boolean;
  class?: string;
  /** Classes of the element wrapping the trigger (sizing in its parent). */
  triggerClass?: string;
}

export function Popover({
  open,
  onOpenChange,
  trigger,
  label,
  children,
  belowDialogs = false,
  class: className,
  triggerClass,
}: PopoverProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = () => {
    // A field being edited inside commits on blur; removing it would not blur it.
    if (panel.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    onOpenChange(false);
    anchor.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Below the trigger, kept inside the window (right-docked triggers open leftward).
  useLayoutEffect(() => {
    if (!open || !anchor.current) {
      setPos(null);
      return;
    }
    const rect = anchor.current.getBoundingClientRect();
    const width = panel.current?.offsetWidth ?? 0;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setPos({ top: rect.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const root = panel.current;
    // The current choice when there is one (a selected card), else the first control.
    const initial =
      root?.querySelector<HTMLElement>('[aria-current="true"]') ??
      root?.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // A menu or dialog opened from the panel owns its own keys.
      const nested = document.querySelector('[role="menu"], [role="dialog"]:not([data-popover])');
      if (e.key === "Escape" && !e.defaultPrevented && !nested) {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !root || nested) {
        return;
      }
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      );
      if (items.length === 0) {
        return;
      }
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div class={cn("relative inline-flex", className)}>
      <div ref={anchor} class={triggerClass}>
        {trigger({
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          onClick: () => onOpenChange(!open),
        })}
      </div>
      {/* Portaled: outside the trigger's ancestors (no drags or context menus from them). */}
      {open &&
        createPortal(
          <div>
            <div
              class={`fixed inset-0 ${belowDialogs ? "z-[50]" : "z-[70]"}`}
              onClick={() => closeRef.current()}
            />
            <div
              ref={panel}
              role="dialog"
              aria-label={label}
              data-popover=""
              class={`fixed rounded-md border border-border bg-popover text-popover-foreground shadow-md ${belowDialogs ? "z-[51]" : "z-[71]"}`}
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            >
              {children}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
