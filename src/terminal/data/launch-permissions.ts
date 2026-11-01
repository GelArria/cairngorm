// Terminals whose launch command started an agent with its permission checks off. Native
// reports it each time a terminal is ensured (started, restored or reattached), so nothing
// here is persisted.
type Listener = () => void;

const permissionsOff = new Set<string>();
const listeners = new Set<Listener>();

/** Records what `pty_ensure` returned; older or mocked replies carry no report. */
export function recordEnsured(sessionId: string, reply: unknown): void {
  if (!reply || typeof reply !== "object" || !("permissionsOff" in reply)) {
    return;
  }
  const off = reply.permissionsOff === true;
  if (off === permissionsOff.has(sessionId)) {
    return;
  }
  if (off) {
    permissionsOff.add(sessionId);
  } else {
    permissionsOff.delete(sessionId);
  }
  for (const listener of listeners) {
    listener();
  }
}

export function hasPermissionsOff(sessionId: string | undefined): boolean {
  return !!sessionId && permissionsOff.has(sessionId);
}

export function subscribeLaunchPermissions(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
