// Keyboard focus for the app menu's rows (roving focus: rows are out of the Tab order).
import { commandAction, runCommand } from "@/keybindings/data/commands";
import type { MenuCommand } from "./menu-sections";

const KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/** Moves focus among `selector` rows of a container; returns whether a key was handled. */
export function moveFocus(
  container: HTMLElement | null,
  e: KeyboardEvent,
  selector: string,
): boolean {
  if (!container || !KEYS.has(e.key)) {
    return false;
  }
  const rows = [...container.querySelectorAll<HTMLElement>(selector)];
  const index = rows.indexOf(document.activeElement as HTMLElement);
  const last = rows.length - 1;
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? last
        : e.key === "ArrowDown"
          ? index < 0 || index === last
            ? 0
            : index + 1
          : index <= 0
            ? last
            : index - 1;
  rows[next]?.focus();
  return true;
}

/** What a menu row runs right now; undefined when the command does not apply. */
export function resolveCommand(item: MenuCommand): (() => void) | undefined {
  if (item.action) {
    return item.action;
  }
  return item.command && commandAction(item.command) ? () => runCommand(item.command!) : undefined;
}

/** Puts focus back on the menu button when nothing else took it. */
export function focusMenuButton(onlyIfLost = false): void {
  if (onlyIfLost && document.activeElement && document.activeElement !== document.body) {
    return;
  }
  document.querySelector<HTMLElement>('[data-testid="header-menu"]')?.focus();
}
