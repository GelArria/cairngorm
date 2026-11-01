// Command registry: every action a shortcut can trigger, available to menus too.
// useKeybinds registers its handlers here, so the app menu runs exactly what the
// keyboard runs and knows when an action does not apply (no handler right now).
import type { KeybindingId } from "./keybindings";

export interface CommandSource {
  handlers: () => Partial<Record<KeybindingId, () => void>>;
  enabled: () => boolean;
}

const sources = new Set<CommandSource>();

export function registerCommands(source: CommandSource): () => void {
  sources.add(source);
  return () => {
    sources.delete(source);
  };
}

/** The action a command runs right now, if any part of the app currently offers it. */
export function commandAction(id: KeybindingId): (() => void) | undefined {
  for (const source of sources) {
    const action = source.handlers()[id];
    if (action && source.enabled()) {
      return action;
    }
  }
  return undefined;
}

export function runCommand(id: KeybindingId): boolean {
  const action = commandAction(id);
  action?.();
  return !!action;
}
