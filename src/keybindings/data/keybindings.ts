import { isEditable, isTerminalInput } from "@/common/dom/input-targets";
import { KEYBINDINGS, bindingKeys, type KeybindingId } from "../model/keybinding-catalog";
import { bindingFromEvent, normalizeBinding } from "../model/keybinding-keys";
export {
  KEYBINDINGS,
  KEYBINDING_CONTEXTS,
  bindingKeys,
  type KeybindingId,
} from "../model/keybinding-catalog";
export { bindingFromEvent } from "../model/keybinding-keys";

export const KEYBINDINGS_STORAGE_KEY = "app-keybindings";
type Overrides = Partial<Record<KeybindingId, string | null>>;
const listeners = new Set<() => void>();

function read(): Overrides {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const result: Overrides = {};
    for (const { id } of KEYBINDINGS) {
      const v = (value as Record<string, unknown>)[id];
      if (v === null) {
        result[id] = null;
      } else {
        const normalized = normalizeBinding(v);
        if (normalized) {
          result[id] = normalized;
        }
      }
    }
    // Corrupt or hand-edited duplicates cannot dispatch two actions.
    const seen = new Set<string>();
    for (const def of KEYBINDINGS) {
      const key = result[def.id] === undefined ? def.default : result[def.id];
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        result[def.id] = null;
      } else {
        seen.add(key);
      }
    }
    return result;
  } catch {
    return {};
  }
}
let overrides = read();
export const getBinding = (id: KeybindingId): string | null =>
  overrides[id] === undefined ? KEYBINDINGS.find((d) => d.id === id)!.default : overrides[id]!;
export const isBindingCustomized = (id: KeybindingId) =>
  Object.prototype.hasOwnProperty.call(overrides, id);

export function shortcutLabel(label: string, id?: KeybindingId): string {
  const binding = id && getBinding(id);
  return binding ? `${label} (${bindingKeys(binding).join("+")})` : label;
}

export function bindingConflict(id: KeybindingId, key: string) {
  return KEYBINDINGS.find((d) => d.id !== id && getBinding(d.id) === key);
}

export function setBinding(id: KeybindingId, value: string | null | undefined): string | null {
  const def = KEYBINDINGS.find((d) => d.id === id)!;
  const next = value === undefined ? def.default : value === null ? null : normalizeBinding(value);
  if (value !== null && !next) {
    return "Use Ctrl / Alt plus a key, or a function key. Clipboard, undo and OS shortcuts are reserved.";
  }
  const conflict = next && bindingConflict(id, next);
  if (conflict) {
    return `Already assigned to ${conflict.label}. Disable or change it first.`;
  }
  const updated = { ...overrides };
  if (next === def.default) {
    delete updated[id];
  } else {
    updated[id] = next;
  }
  return persist(updated);
}
function persist(next: Overrides): string | null {
  try {
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return "Could not save keybindings. Check available local storage.";
  }
  overrides = next;
  listeners.forEach((fn) => fn());
  return null;
}
export const resetBindings = () => persist({});
window.addEventListener("storage", (e) => {
  if (e.key !== KEYBINDINGS_STORAGE_KEY && e.key !== null) {
    return;
  }
  overrides = read();
  listeners.forEach((fn) => fn());
});

export function matchesBinding(e: KeyboardEvent, id: KeybindingId): boolean {
  if (e.defaultPrevented || e.isComposing || e.repeat) {
    return false;
  }
  if (
    document.querySelector(
      '[role="dialog"][aria-modal="true"], [role="menu"], [data-keybinding-capture]',
    )
  ) {
    return false;
  }
  // CodeMirror gets first refusal; unhandled app commands run in the bubble listener.
  if (e.eventPhase === Event.CAPTURING_PHASE && (e.target as Element)?.closest?.(".cm-editor")) {
    return false;
  }
  const def = KEYBINDINGS.find((d) => d.id === id)!;
  const pressed = bindingFromEvent(e);
  if (isTerminalInput(e.target)) {
    if (def.context === "app" || def.context === "navigation") {
      return false;
    }
    // Remapping a pane command must not turn shell editing (Ctrl+C/W/…) into an app action.
    if (pressed && /^Ctrl\+([A-Z3-8\[\]\\]|Space|Backspace|Delete)$/.test(pressed)) {
      return false;
    }
    if (pressed === "Ctrl+Shift+2") {
      return false;
    } // Ctrl+@ is xterm's NUL alias.
  }
  if (
    def.context === "navigation" &&
    (isEditable(e.target) || (e.target as Element)?.closest?.(".cm-editor, select"))
  ) {
    return false;
  }
  const binding = getBinding(id);
  return binding !== null && pressed === binding;
}

export function handleBinding(e: KeyboardEvent, id: KeybindingId, action: () => void): boolean {
  if (!matchesBinding(e, id)) {
    return false;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  action();
  return true;
}

export function subscribeKeybindings(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
