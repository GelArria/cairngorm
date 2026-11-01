import { invoke } from "@tauri-apps/api/core";

type TerminalEvent = "terminal-detached-state" | "terminal-reattach" | `pty-kill-${string}`;

// Tauri's event plugin emits off-thread; use the native main-thread delivery instead.
export function emitTerminalEvent(
  event: TerminalEvent,
  payload: unknown,
  target?: "main",
): Promise<void> {
  return invoke("emit_terminal_event", { event, payload, target: target ?? null });
}
