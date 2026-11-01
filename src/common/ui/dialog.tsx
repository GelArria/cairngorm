// shadcn-style Dialog (no Radix): portal to <body>, dimmed overlay, Esc and
// overlay click close, header with title/description and a close button.
import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { cn } from "@/common/utils";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ComponentChildren;
  class?: string;
  compact?: boolean;
  "data-testid"?: string;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  class: className,
  compact = false,
  ...rest
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  // latest onClose without re-running the open effect (an inline callback from
  // the parent would otherwise reset focus on every parent re-render)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // The opener is captured while rendering the open transition: the commit that
  // follows may already move focus inside (autoFocus fields).
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    opener.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = open;
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const before = opener.current;
    const initialFocus = panel.current?.querySelector<HTMLElement>("[autofocus]");
    if (initialFocus) {
      initialFocus.focus();
    } else if (!panel.current?.contains(document.activeElement)) {
      panel.current?.focus();
    }
    const ownsFocus = () => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const top = dialogs[dialogs.length - 1];
      return (
        !!panel.current &&
        top === panel.current.closest('[role="dialog"]') &&
        ![...document.querySelectorAll<HTMLElement>('[role="menu"]')].some(
          (menu) =>
            panel.current?.contains(menu) ||
            Number(getComputedStyle(menu).zIndex) > Number(getComputedStyle(top).zIndex),
        )
      );
    };
    let focused = document.activeElement as HTMLElement | null;
    const onFocus = (e: FocusEvent) => {
      if (!ownsFocus()) {
        return;
      }
      if (panel.current?.contains(e.target as Node)) {
        focused = e.target as HTMLElement;
      } else {
        // Async terminal attachment must not steal input from a modal confirmation.
        (focused?.isConnected && panel.current?.contains(focused)
          ? focused
          : panel.current
        )?.focus();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !ownsFocus()) {
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) {
        return;
      }
      // keep Tab inside the dialog
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      );
      if (items.length === 0) {
        return;
      }
      const first = items[0],
        last = items[items.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [open]);

  if (!open) {
    return null;
  }
  return createPortal(
    // Theme tokens come from <html>, including portaled content.
    <div
      class="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div class="absolute inset-0 bg-black/60 animate-in fade-in duration-150" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        data-testid={rest["data-testid"]}
        class={cn(
          "relative z-10 flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card surface-overlay text-foreground shadow-lg shadow-black/60 outline-none animate-in fade-in zoom-in-95 duration-150",
          className,
        )}
      >
        <div
          class={cn(
            "flex shrink-0 items-start gap-3 border-b border-border",
            compact ? "px-3 py-2.5" : "px-5 py-4",
          )}
        >
          <div class="min-w-0 flex-1">
            <h2 class="text-sm font-semibold">{title}</h2>
            {description && <p class="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          <Button
            variant="subtle"
            size="icon"
            class="-mr-1 h-7 w-7 shrink-0"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" class="text-sm" />
          </Button>
        </div>
        <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
