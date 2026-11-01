import { handleBinding, type KeybindingId } from "@/keybindings/data/keybindings";
import { useLayoutEffect, useRef } from "preact/hooks";
import { registerCommands } from "../data/commands";

type KeybindHandlers = Partial<Record<KeybindingId, () => void>>;

export function useKeybinds(handlers: KeybindHandlers, enabled: () => boolean = () => true): void {
  const current = useRef({ handlers, enabled });
  current.current = { handlers, enabled };
  useLayoutEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (!current.current.enabled()) {
        return;
      }
      for (const [id, action] of Object.entries(current.current.handlers)) {
        if (action && handleBinding(e, id as KeybindingId, action)) {
          return;
        }
      }
    };
    window.addEventListener("keydown", listener, true);
    window.addEventListener("keydown", listener);
    // Menus run the same handlers (see commands.ts).
    const unregister = registerCommands({
      handlers: () => current.current.handlers,
      enabled: () => current.current.enabled(),
    });
    return () => {
      window.removeEventListener("keydown", listener, true);
      window.removeEventListener("keydown", listener);
      unregister();
    };
  }, []);
}
