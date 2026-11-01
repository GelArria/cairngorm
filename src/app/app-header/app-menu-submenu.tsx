// One category's commands, opened beside the app menu and kept inside the window.
import { Icon } from "@/common/ui/icon";
import { Kbd } from "@/common/ui/kbd";
import { cn } from "@/common/utils";
import { bindingKeys, getBinding } from "@/keybindings/data/keybindings";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { moveFocus, resolveCommand } from "./app-menu-focus";
import type { MenuGroup } from "./menu-sections";

export const MENU_ROW =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none focus-visible:bg-accent hover:bg-accent aria-expanded:bg-accent";
export const submenuId = (label: string) => `app-menu-${label.toLowerCase()}`;

export function Submenu({
  group,
  autoFocus,
  onRun,
  onBack,
}: {
  group: MenuGroup;
  autoFocus: boolean;
  onRun: (action: () => void) => void;
  onBack: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (autoFocus) {
      ref.current?.querySelector<HTMLElement>("[data-menu-row]")?.focus();
    }
  }, [autoFocus]);
  // Kept inside the window: flip left when there is no room on the right, lift when
  // the list would run past the bottom edge.
  const [place, setPlace] = useState({ flip: false, lift: 0 });
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setPlace({
      flip: rect.right > window.innerWidth - 8,
      lift: Math.max(0, rect.bottom - (window.innerHeight - 8)),
    });
  }, [group.label]);
  return (
    <div
      ref={ref}
      id={submenuId(group.label)}
      role="menu"
      aria-label={group.label}
      class={cn(
        "absolute top-0 w-[240px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
        place.flip ? "right-full mr-1.5" : "left-full ml-1.5",
      )}
      style={place.lift ? { top: -place.lift } : undefined}
      onKeyDown={(e) => {
        if (moveFocus(ref.current, e, "[data-menu-row]")) {
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === "ArrowLeft" || e.key === "Escape") {
          // Back to the category; the menu itself stays open (it skips handled keys).
          e.preventDefault();
          e.stopPropagation();
          onBack();
        }
      }}
    >
      {group.items.map((item, i) => {
        if (item === "separator") {
          return <div key={`sep-${i}`} role="separator" class="-mx-1 my-1 h-px bg-border" />;
        }
        const action = resolveCommand(item);
        const id = item.command ?? item.keybind;
        const binding = id ? getBinding(id) : null;
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            data-menu-row=""
            tabIndex={-1}
            aria-disabled={action ? undefined : "true"}
            class={cn(MENU_ROW, !action && "cursor-default opacity-45 hover:bg-transparent")}
            onClick={() => action && onRun(action)}
          >
            <Icon name={item.icon} class="text-sm text-muted-foreground" />
            <span class="flex-1 truncate">{item.label}</span>
            {binding && <Kbd keys={bindingKeys(binding)} />}
          </button>
        );
      })}
    </div>
  );
}
