import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ProjectLoader } from "@/projects/visuals";
import { useEffect, useRef, useState } from "preact/hooks";
import { type PtyHandle } from "../data/pty-manager";
import type { TerminalTabProps } from "../model/terminal-options";
import { mountTerminal } from "../runtime/terminal-runtime";

export function TerminalTab({
  active = true,
  sessionId,
  projectId,
  shellPath,
  shellArgs,
  shellEnv,
  cwd,
  isAgent,
  onStatusChange,
  onRestart,
}: TerminalTabProps) {
  const [readySession, setReadySession] = useState<string | null>(null);
  const loading = readySession !== sessionId;
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<PtyHandle | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(
    () =>
      mountTerminal({
        termRef,
        xtermRef,
        ptyRef,
        activeRef,
        sessionId,
        shellPath,
        shellArgs,
        shellEnv,
        cwd,
        isAgent,
        onStatusChange,
        onRestart,
        onReady: () => setReadySession(sessionId),
      }),
    [sessionId],
  );

  return (
    // NO padding: FitAddon subtracts only the padding of the .xterm itself, not the
    // parent’s — padding here makes rows for the FULL height → the last row
    // overflows and the pane’s overflow-hidden clips it ("lower band" broken in splits).
    // The grid already separates with a 2px gap. The inner margin lives on .xterm
    // (index.css); this bg (= theme bg) fills the sub-row remainder at the bottom.
    <div class="relative h-full w-full" aria-busy={loading}>
      {/* Preserve focus and fitting without painting through a translucent loader. */}
      <div
        ref={termRef}
        class="surface-base h-full w-full bg-background"
        style={{ cursor: "text", opacity: loading ? 0 : 1 }}
      />
      {loading && (
        <div class="pointer-events-none absolute inset-0 z-[1] bg-background surface-terminal">
          <ProjectLoader projectId={projectId} />
        </div>
      )}
    </div>
  );
}
