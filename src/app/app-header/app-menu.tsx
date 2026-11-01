// The title bar's app menu: categories that open their commands to the side, like a
// desktop menu bar folded into one button. Arrows move, → opens, ← or Esc returns to the
// category, Enter runs, Tab closes. Disabled commands stay reachable, announced as disabled.
import { DropdownMenu } from "@/common/ui/dropdown-menu";
import { Icon } from "@/common/ui/icon";
import { useKeybindingPreferences } from "@/keybindings/hooks/use-keybinding-preferences";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { focusMenuButton, moveFocus } from "./app-menu-focus";
import { MENU_ROW, Submenu, submenuId } from "./app-menu-submenu";
import { HeaderButton } from "./header-button";
import type { MenuGroup } from "./menu-sections";

const CATEGORY = ":scope > div > button[data-menu-row]";
/** Hovering another category waits this long, so a diagonal move into a submenu
 *  can cross other categories without switching it. */
const HOVER_SWITCH_MS = 180;

export function AppMenu({ groups }: { groups: MenuGroup[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [focusSubmenu, setFocusSubmenu] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const hover = useRef<number>();
  useKeybindingPreferences();
  useEffect(() => () => window.clearTimeout(hover.current), []);
  const category = (index: number) =>
    top.current?.querySelector<HTMLElement>(`[data-group="${index}"] > button`);
  const change = (next: boolean) => {
    window.clearTimeout(hover.current);
    setOpen(next);
    setActive(null);
    if (!next) {
      // Escape, Tab or a click outside: keyboard users return to the menu button.
      requestAnimationFrame(() => focusMenuButton());
    }
  };
  const hoverGroup = (index: number) => {
    window.clearTimeout(hover.current);
    if (active === index) {
      return;
    }
    const show = () => {
      // Keep keyboard focus alive: a focused row inside the old submenu unmounts.
      const hadFocus = top.current?.contains(document.activeElement);
      setFocusSubmenu(false);
      setActive(index);
      if (hadFocus) {
        category(index)?.focus();
      }
    };
    if (active === null) {
      show();
    } else {
      hover.current = window.setTimeout(show, HOVER_SWITCH_MS);
    }
  };
  // Keyboard users land on the first category.
  useLayoutEffect(() => {
    if (open) {
      category(0)?.focus();
    }
  }, [open]);
  const openGroup = (index: number) => {
    window.clearTimeout(hover.current);
    setFocusSubmenu(true);
    setActive(index);
    // An already-open submenu will not remount or rerun its initial-focus effect.
    top.current
      ?.querySelector<HTMLElement>(`#${submenuId(groups[index].label)} [data-menu-row]`)
      ?.focus();
  };
  const run = (action: () => void) => {
    window.clearTimeout(hover.current);
    setOpen(false);
    setActive(null);
    // After the menu unmounts: an action may open a dialog that takes focus; when
    // it does not, focus returns to the menu button instead of the page body.
    requestAnimationFrame(() => {
      action();
      requestAnimationFrame(() => focusMenuButton(true));
    });
  };
  return (
    <DropdownMenu
      open={open}
      onOpenChange={change}
      label="Application menu"
      trigger={<HeaderButton tip="Menu" icon="list" testId="header-menu" />}
    >
      <div
        ref={top}
        class="flex w-[168px] flex-col"
        onKeyDown={(e) => {
          // Categories only: an open submenu handles its own rows.
          if (moveFocus(top.current, e, CATEGORY)) {
            e.preventDefault();
            window.clearTimeout(hover.current);
            setActive(null);
          } else if (e.key === "Tab") {
            e.preventDefault();
            change(false);
          }
        }}
      >
        {groups.map((group, index) => (
          <div
            key={group.label}
            class="relative"
            data-group={index}
            onMouseEnter={() => hoverGroup(index)}
          >
            <button
              type="button"
              role="menuitem"
              data-menu-row=""
              tabIndex={-1}
              aria-haspopup="menu"
              aria-expanded={active === index}
              aria-controls={active === index ? submenuId(group.label) : undefined}
              class={MENU_ROW}
              onClick={() => openGroup(index)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  openGroup(index);
                }
              }}
            >
              <Icon name={group.icon} class="text-sm text-muted-foreground" />
              <span class="flex-1">{group.label}</span>
              <Icon name="caret-right" class="text-[10px] text-muted-foreground" />
            </button>
            {active === index && (
              <Submenu
                group={group}
                autoFocus={focusSubmenu}
                onRun={run}
                onBack={() => {
                  setActive(null);
                  category(index)?.focus();
                }}
              />
            )}
          </div>
        ))}
      </div>
    </DropdownMenu>
  );
}
