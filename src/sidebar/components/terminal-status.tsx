import { AgentRunStatus } from "@/sidebar/hooks/use-agent-run-status";
import { DotState, dotState } from "@/sidebar/model/terminal-status";
// Shared terminal-status primitives for the sidebar: status dots
// (amber = running, green hollow = available, green check = done,
// red = error, blue = detached) + per-session agent run status.
import { CheckDrawIcon } from "@/common/ui/animated-icon";
import type { TermTab } from "../../terminal/types";

/** herdr status dot, minimal: amber dot w/ soft glow = running,
 *  hollow emerald ring = available, emerald check = done (agent finished),
 *  red = error, hollow blue = detached. Pulse only while reconnecting.
 *  plain shells have no prompt-vs-busy signal — always amber while
 *  alive; wire PTY OSC 133 marks if shell busy/idle ever matters. */
const GLOW = { boxShadow: "0 0 6px rgba(251,191,36,.45)" };

export function StatusGlyph({ state }: { state: DotState }) {
  switch (state) {
    case "shell":
      return null;
    case "detached":
      return (
        <span class="h-1.5 w-1.5 rounded-full border border-sky-400/70 bg-sky-400/15 shrink-0" />
      );
    case "error":
      return <span class="h-1.5 w-1.5 rounded-full bg-red-400/90 shrink-0" />;
    case "done":
      return <CheckDrawIcon class="text-[10px] text-emerald-400" />;
    case "available":
      return <span class="h-1.5 w-1.5 rounded-full border border-emerald-400/70 shrink-0" />;
    case "reconnecting":
      return <span class="h-1.5 w-1.5 rounded-full bg-amber-400/80 animate-pulse shrink-0" />;
    default:
      return <span class="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" style={GLOW} />;
  }
}

export function StatusDot({ tab, agentRun }: { tab: TermTab; agentRun?: AgentRunStatus }) {
  return <StatusGlyph state={dotState(tab, agentRun)} />;
}
