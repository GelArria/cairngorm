import type { TestRun } from "../model/types";

const runs = new Map<string, TestRun>();
const listeners = new Map<string, Set<() => void>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Batch PTY updates without rerendering the workspace/sidebar on every output line. */
export function publishTestRun(run: TestRun) {
  runs.set(run.sessionId, run);
  if (pending.has(run.sessionId)) {
    return;
  }
  pending.set(
    run.sessionId,
    setTimeout(() => {
      pending.delete(run.sessionId);
      listeners.get(run.sessionId)?.forEach((fn) => fn());
    }, 80),
  );
}

export function forgetTestRun(sessionId: string) {
  clearTimeout(pending.get(sessionId));
  pending.delete(sessionId);
  runs.delete(sessionId);
  listeners.get(sessionId)?.forEach((fn) => fn());
}

export const getTestRun = (sessionId: string): TestRun | undefined => runs.get(sessionId);

export function subscribeTestRun(sessionId: string, update: () => void) {
  const group = listeners.get(sessionId) ?? new Set<() => void>();
  listeners.set(sessionId, group);
  group.add(update);
  return () => {
    group.delete(update);
    if (!group.size) {
      listeners.delete(sessionId);
    }
  };
}
