import { useEffect, useState } from "preact/hooks";

export type AgentRunStatus = "running" | "ended";

/** Per-session agent run status from the global `agent-event` Tauri event
 *  (emitted by the Rust PTY parser — reaches every webview). The tab store
 *  keeps status "running" for agents between prompts, so this is the only
 *  real running/ended signal. */
export function useAgentRunStatus(): Record<string, AgentRunStatus> {
  const [status, setStatus] = useState<Record<string, AgentRunStatus>>({});
  useEffect(() => {
    let un: (() => void) | null = null;
    let disposed = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        un = await listen<{ type: string; session_id: string }>("agent-event", (e) => {
          const { type, session_id: sid } = e.payload;
          if (!sid) {
            return;
          }
          if (type === "agent_start") {
            setStatus((p) => ({ ...p, [sid]: "running" }));
          } else if (type === "agent_end") {
            setStatus((p) => ({ ...p, [sid]: "ended" }));
          }
        });
        if (disposed) {
          un();
          un = null;
        }
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      disposed = true;
      un?.();
    };
  }, []);
  return status;
}
