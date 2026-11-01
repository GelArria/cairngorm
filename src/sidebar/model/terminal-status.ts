import { AgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import type { TermTab } from "@/terminal/types";

/** "shell" = a plain terminal that is alive: no dot — green / amber are agent-only signals. */
export type DotState =
  | "detached"
  | "error"
  | "done"
  | "running"
  | "reconnecting"
  | "available"
  | "shell";

export function dotState(tab: TermTab, agentRun?: AgentRunStatus): DotState {
  if (tab.detached) {
    return "detached";
  }
  if (tab.status === "error") {
    return "error";
  }
  if (tab.isAgent) {
    if (agentRun === "ended") {
      return "done";
    }
    if (agentRun === "running") {
      return "running";
    }
    return "available";
  }
  if (tab.status === "reconnecting") {
    return "reconnecting";
  }
  return "shell";
}

/** Collapsed-group roll-up: error beats running beats done (plain shells are
 *  always "running", so error must win to ever surface); null = nothing to flag. */
export function rollupState(
  tabs: TermTab[],
  agentRun: Record<string, AgentRunStatus>,
): "running" | "error" | "done" | null {
  const states = tabs.map((t) => dotState(t, agentRun[t.sessionId]));
  if (states.includes("error")) {
    return "error";
  }
  if (states.some((s) => s === "running" || s === "reconnecting")) {
    return "running";
  }
  if (states.includes("done")) {
    return "done";
  }
  return null;
}
