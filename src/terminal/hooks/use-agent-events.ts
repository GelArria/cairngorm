import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "preact/hooks";
import { agentEnvironment, needsEngineEnvironment } from "../data/session-launch";
import type { AgentEvent, AgentSessionState } from "../shared/agent-events";

export interface UseAgentEventsReturn {
  events: AgentEvent[];
  sessions: Record<string, AgentSessionState>;
  getEvents(sessionId: string): AgentEvent[];
  getStatus(sessionId: string): AgentSessionState["status"];
  sendPrompt(sessionId: string, content: string, ensure?: PromptEnsure): Promise<void>;
  steer(sessionId: string, instruction: string, mode?: string): Promise<void>;
  kill(sessionId: string): Promise<void>;
}

/** Shell identity needed to recreate a dead agent PTY (see pty_ensure). */
export interface PromptEnsure {
  shell: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export function useAgentEvents(): UseAgentEventsReturn {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [sessions, setSessions] = useState<Record<string, AgentSessionState>>({});

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      // Guarded like the rest of the codebase (terminal-status, app-level listens):
      // outside Tauri (E2E/browser) listen() rejects with transformCallback undefined
      // — unguarded it surfaces as unhandledrejection and opens the crash dialog.
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<AgentEvent>("agent-event", (e) => {
          const ev = e.payload;
          if (!ev?.type || !ev?.session_id) {
            return;
          }
          setEvents((prev) => {
            const next = [...prev, ev];
            if (next.length > 500) {
              next.splice(0, next.length - 500);
            }
            return next;
          });
          setSessions((prev) => {
            const sid = ev.session_id;
            const current = prev[sid] ?? { status: "idle" as const };
            switch (ev.type) {
              case "agent_start":
                return { ...prev, [sid]: { status: "running", startedAt: Date.now() } };
              case "agent_end":
                return { ...prev, [sid]: { ...current, status: "ended", endedAt: Date.now() } };
              default:
                return prev;
            }
          });
        });
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const getEvents = useCallback(
    (sessionId: string) => events.filter((e) => e.session_id === sessionId),
    [events],
  );

  const getStatus = useCallback(
    (sessionId: string) => sessions[sessionId]?.status ?? "idle",
    [sessions],
  );

  const sendCommand = useCallback(async (sessionId: string, command: Record<string, unknown>) => {
    if (!sessionId) {
      return;
    }
    await invoke("pty_write", { sessionId, data: JSON.stringify(command) + "\n" });
  }, []);

  /** Recreate the agent PTY if it died (mirrors the TUI Enter path in terminal-tab). */
  const ensureSession = useCallback(async (sessionId: string, ensure?: PromptEnsure) => {
    if (!ensure?.shell) {
      return;
    }
    const env = needsEngineEnvironment(ensure.args, ensure.env)
      ? await agentEnvironment(ensure.args)
      : ensure.env;
    await invoke("pty_ensure", {
      sessionId,
      shell: ensure.shell,
      args: ensure.args ?? [],
      cwd: ensure.cwd ?? null,
      env: env ? Object.entries(env) : [],
      parseJsonl: true,
      killOnAgentEnd: false,
    });
  }, []);

  const sendPrompt = useCallback(
    async (sessionId: string, content: string, ensure?: PromptEnsure) => {
      await ensureSession(sessionId, ensure);
      await sendCommand(sessionId, { type: "prompt", content });
    },
    [sendCommand, ensureSession],
  );

  const steer = useCallback(async (sessionId: string, instruction: string, mode?: string) => {
    if (!sessionId || !instruction.trim()) {
      return;
    }
    await invoke("agent_steer", { sessionId, instruction, mode });
  }, []);

  const kill = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      return;
    }
    await invoke("pty_kill", { sessionId });
  }, []);

  return { events, sessions, getEvents, getStatus, sendPrompt, steer, kill };
}
