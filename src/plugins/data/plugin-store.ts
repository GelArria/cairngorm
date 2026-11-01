// Plugin calls seen by this window. The view tab shows the latest call of its terminal;
// older calls stay addressable while their views finish reporting.
import type { PluginCall, PluginCallState } from "../model/types";

const MAX_CALLS = 64;
const calls = new Map<string, PluginCallState>();
const listeners = new Set<() => void>();
const inputDelivered = new Set<string>();
const referenced = new Set<string>();

/** Pane references survive unmount/project switches; only finished, unreferenced calls expire. */
export function retainPluginCalls(ids: string[]) {
  referenced.clear();
  ids.forEach((id) => referenced.add(id));
  trimClosedCalls();
}

function trimClosedCalls() {
  const closed = [...calls].filter(
    ([id, state]) => !referenced.has(id) && state.status !== "running",
  );
  for (const [id] of closed.slice(0, Math.max(0, closed.length - MAX_CALLS))) {
    calls.delete(id);
    inputDelivered.delete(id);
  }
}

function changed() {
  listeners.forEach((listener) => listener());
}

export function publishPluginCall(call: PluginCall) {
  calls.set(call.id, { call, status: "running", startedAt: Date.now() });
  referenced.add(call.id);
  trimClosedCalls();
  changed();
}

export function finishPluginCall(id: string, result?: Record<string, unknown>, error?: string) {
  const state = calls.get(id);
  if (!state) {
    return;
  }
  const failed = error != null || result?.isError === true;
  calls.set(id, { ...state, status: failed ? "failed" : "done", result, error, recovered: false });
  trimClosedCalls();
  changed();
}

/** Preserve recovery status across project-driven pane remounts. */
export function markPluginRecovered(id: string) {
  const state = calls.get(id);
  if (state) {
    calls.set(id, { ...state, recovered: true });
    changed();
  }
}

/** True only for the first view of a call: its input must run once. */
export function claimPluginInput(id: string): boolean {
  if (inputDelivered.has(id) || !calls.has(id)) {
    return false;
  }
  inputDelivered.add(id);
  return true;
}

export function getPluginCall(id: string | undefined): PluginCallState | undefined {
  return id ? calls.get(id) : undefined;
}

export function subscribePluginCalls(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
