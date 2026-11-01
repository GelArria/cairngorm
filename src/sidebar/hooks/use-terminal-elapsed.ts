// Sidebar-only "time in current state" per terminal (9s / 2m / 1h). The tab
// store has no timestamps, so marks live here: reset when a tab first appears
// or when its status / detached / agent-run state changes. UI-only — never
// written back to the terminal store. Module scope so the marks survive the
// section unmounting on view switches.
import type { AgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import { useEffect } from "preact/hooks";
import type { TermTab } from "../../terminal/types";

const marks = new Map<string, { key: string; at: number }>();

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  return `${Math.floor(m / 60)}h`;
}

/** Records a new mark for every tab whose state key changed; drops closed tabs. */
export function syncMarks(
  tabs: TermTab[],
  agentRun: Record<string, AgentRunStatus>,
  now = Date.now(),
) {
  const seen = new Set<string>();
  for (const t of tabs) {
    const key = `${t.status}|${t.detached}|${agentRun[t.sessionId] ?? ""}`;
    if (marks.get(t.id)?.key !== key) {
      marks.set(t.id, { key, at: now });
    }
    seen.add(t.id);
  }
  for (const id of [...marks.keys()]) {
    if (!seen.has(id)) {
      marks.delete(id);
    }
  }
}

export const markOf = (tabId: string) => marks.get(tabId)?.at;

/** Keeps the marks in step with the tabs (no re-render of its own). */
export function useTerminalMarks(tabs: TermTab[], agentRun: Record<string, AgentRunStatus>) {
  // Sync during render too, so a row's first paint already has its mark
  syncMarks(tabs, agentRun);
  useEffect(() => {
    syncMarks(tabs, agentRun);
  }, [tabs, agentRun]);
}

// One shared 1 s ticker for every <Elapsed/> leaf; stops when none is mounted.
const tickers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function subscribeTick(fn: () => void): () => void {
  tickers.add(fn);
  if (!timer) {
    timer = setInterval(() => tickers.forEach((t) => t()), 1000);
  }
  return () => {
    tickers.delete(fn);
    if (tickers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
