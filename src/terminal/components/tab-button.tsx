import { Button } from "@/common/ui/button";
import { Icon } from "@/common/ui/icon";
import { Tooltip } from "@/common/ui/tooltip";
import { usePermissionsOff } from "../hooks/use-permissions-off";
import type { TermTab } from "../model/types";

/** Only states worth a glance get a dot; a running shell / a file is the normal case. */
const statusDotClass = (tab: { detached?: boolean; status: string }) =>
  tab.detached
    ? "bg-blue-400"
    : tab.status === "reconnecting"
      ? "bg-yellow-400"
      : tab.status === "error"
        ? "bg-red-400"
        : null;

export function TabButton({
  tab,
  groupColor,
  isActive,
  onSelect,
  onClose,
  onDetach,
  onRestart,
  onContextMenu,
  onDragMove,
  onDragDrop,
  onDragCancel,
}: {
  tab: TermTab;
  /** Split group colour: draws a hairline under the tab. */
  groupColor?: string;
  isActive: boolean;
  onSelect: (keyboard: boolean) => void;
  onClose: () => void;
  onDetach: (tabId: string) => void;
  onRestart: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  /** Dragging over the window (dock preview over the grid) */
  onDragMove?: (x: number, y: number) => void;
  /** Released inside the window: true = docked into the grid */
  onDragDrop?: (x: number, y: number) => boolean;
  onDragCancel?: () => void;
}) {
  const handleMouseDown = (e: MouseEvent) => {
    // Middle click = close (tab standard); preventDefault cuts the autoscroll
    if (e.button === 1) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.button !== 0) {
      return;
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let tearing = false;

    // Snip Tool / alt-tab steal the input: the mouseup lands in another process →
    // cancel on blur and on the first buttonless move (never a phantom detach).
    const cleanup = () => {
      if (tearing) {
        onDragCancel?.();
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
      document.body.style.cursor = "";
    };
    const onBlur = () => cleanup();

    // No ghost DOM: the little title card used to stick around when the
    // mouseup was lost (native/desktop title bar). Cursor grabbing only.
    const onMove = (ev: MouseEvent) => {
      if (ev.buttons === 0) {
        cleanup();
        return;
      }
      if (!tearing) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dx * dx + dy * dy > 400) {
          tearing = true;
          document.body.style.cursor = "grabbing";
        }
      }
      if (tearing) {
        onDragMove?.(ev.clientX, ev.clientY);
      }
    };

    const onUp = (ev: MouseEvent) => {
      const wasTearing = tearing;
      const outside =
        ev.clientX < 0 ||
        ev.clientX > window.innerWidth ||
        ev.clientY < 0 ||
        ev.clientY > window.innerHeight;
      // Inside the window: dock into the grid (the preview decides where)
      const docked =
        wasTearing && ev.button === 0 && !outside && !!onDragDrop?.(ev.clientX, ev.clientY);
      tearing = docked ? false : tearing; // a dock is not a cancel
      cleanup();
      if (ev.button !== 0) {
        return;
      } // coordinated release: cancel, never detach
      if (!wasTearing || docked) {
        return;
      }
      // Released outside window bounds → detach
      if (outside && !tab.detached) {
        onDetach(tab.id);
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onBlur);
  };

  const dot = statusDotClass(tab);
  const dirty = tab.kind === "file" && !!tab.isDirty;
  const permissionsOff = usePermissionsOff(tab.kind ? undefined : tab.sessionId);
  return (
    <div
      data-tab-id={tab.id}
      title={[
        tab.title,
        tab.detached ? "(detached)" : "",
        permissionsOff ? "— agent started with its permission checks off" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      class={`group flex h-9 shrink-0 items-center gap-2 pl-3 pr-1.5 border-r border-border cursor-grab active:cursor-grabbing select-none transition-colors ${
        isActive
          ? "surface-tab-active bg-background text-foreground"
          : "text-muted-foreground hover:bg-accent"
      }`}
      onClick={(e) => onSelect(e.detail === 0)}
      onMouseDown={(e) => {
        if (!(e.target as Element).closest("[data-tab-close]")) {
          handleMouseDown(e);
        }
      }}
      onContextMenu={onContextMenu}
      style={
        groupColor
          ? { boxShadow: `inset 0 -2px 0 ${groupColor}${isActive ? "" : "b3"}` }
          : undefined
      }
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-label={tab.detached ? `${tab.title} (detached)` : tab.title}
        tabIndex={isActive ? 0 : -1}
        class="flex h-full min-w-0 items-center gap-2 text-left"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(e.detail === 0);
        }}
      >
        {dot && (
          <span
            role="img"
            class={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
            aria-label={tab.detached ? "Detached" : tab.status}
          />
        )}
        {permissionsOff && (
          <Icon
            name="shield-off"
            role="img"
            aria-label="Permission checks off"
            class="shrink-0 text-xs text-amber-500"
            data-testid="tab-permissions-off"
          />
        )}
        {tab.kind === "tests" && <Icon name="check-circle" class="text-xs text-muted-foreground" />}
        {tab.kind === "plugin" && <Icon name="plug" class="text-xs text-muted-foreground" />}
        {tab.kind === "app" && <Icon name="layout" class="text-xs text-muted-foreground" />}
        <span
          class={`max-w-[90px] sm:max-w-[160px] truncate text-[12px] ${isActive ? "text-foreground" : ""}`}
          data-testid="tab-title"
        >
          {tab.title}
        </span>
        {tab.detached && <Icon name="arrow-square-out" class="text-[10px] text-blue-400/70" />}
      </button>
      {(tab.status === "error" || tab.status === "reconnecting") && (
        <Button
          variant="subtle"
          size="icon-xs"
          class="hover:text-cyan-400"
          aria-label="Restart terminal"
          title="Restart terminal"
          onClick={(e) => {
            e.stopPropagation();
            onRestart();
          }}
        >
          <Icon name="arrow-clockwise" class="text-[11px]" />
        </Button>
      )}
      {/* Close slot: an unsaved file shows a dot here that turns into × on hover */}
      <Tooltip
        content={dirty ? "Close unsaved tab" : "Close tab"}
        shortcut={isActive ? "closePane" : undefined}
      >
        <Button
          data-tab-close
          variant="subtle"
          size="icon-xs"
          title=""
          aria-label={dirty ? "Close tab (unsaved changes)" : "Close tab"}
          class="group/close relative shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          {dirty && (
            <span class="h-1.5 w-1.5 rounded-full bg-foreground/70 group-hover:hidden group-focus-visible/close:hidden" />
          )}
          <Icon
            name="x"
            class={
              dirty
                ? "hidden group-hover:block group-focus-visible/close:block"
                : "opacity-100 sm:opacity-0 group-hover:opacity-100 group-focus-visible/close:opacity-100"
            }
          />
        </Button>
      </Tooltip>
    </div>
  );
}
