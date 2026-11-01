import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { base64ToUint8Array, concatBytes, stripReplaySuffix } from "../model/pty-bytes";
import { recordEnsured } from "./launch-permissions";
import { agentEnvironment } from "./session-launch";
import { debugLog } from "./terminal-debug-logger";

interface PtyDataEvent {
  data: string; // base64
}

interface PtyExitEvent {
  // empty
}

export interface PtyHandle {
  replaySize?: { cols: number; rows: number };
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
  detach(): void;
  onData(cb: (data: Uint8Array, replay?: boolean) => void): void;
  onExit(cb: (code: number | null) => void): void;
  /** Injects the backend replay (agent tabs). Call after registering onData. */
  flushReplay(): boolean;
}

export interface PtyLaunchOptions {
  sessionId: string;
  shellPath: string;
  shellArgs?: string[];
  shellEnv?: Record<string, string>;
  cwd?: string;
  isAgent?: boolean;
}

export async function attachPty({
  sessionId,
  shellPath,
  shellArgs,
  shellEnv,
  cwd,
  isAgent = false,
}: PtyLaunchOptions): Promise<PtyHandle> {
  debugLog("pty", "attach-start", `sid=${sessionId} shell=${shellPath} isAgent=${isAgent}`);
  // Ensure PTY exists in Rust backend
  const launchEnv = isAgent && !shellEnv ? await agentEnvironment(shellArgs) : shellEnv;
  const envPairs: [string, string][] = launchEnv ? Object.entries(launchEnv) : [];
  try {
    const ensured = await invoke("pty_ensure", {
      sessionId,
      shell: shellPath,
      args: shellArgs ?? [],
      cwd: cwd ?? null,
      env: envPairs,
      parseJsonl: isAgent,
      killOnAgentEnd: false,
    });
    recordEnsured(sessionId, ensured);
    debugLog("pty", "ensure-ok", `sid=${sessionId}`);
  } catch (err) {
    debugLog("pty", "ensure-failed", `sid=${sessionId} err=${err}`);
    throw err;
  }

  const dataCbs: ((data: Uint8Array, replay?: boolean) => void)[] = [];
  const exitCbs: ((code: number | null) => void)[] = [];

  let unlistenData: (() => void) | null = null;
  let unlistenExit: (() => void) | null = null;

  const detach = () => {
    try {
      unlistenData?.();
    } catch {
      /* listener may be destroyed */
    }
    try {
      unlistenExit?.();
    } catch {
      /* listener may be destroyed */
    }
    unlistenData = null;
    unlistenExit = null;
  };

  // Replay: agent tabs do not persist scrollback in localStorage; on reattach
  // (inline remount or detached window) the xterm is born empty. We ask the backend
  // for the output ring buffer and inject it before live data, queuing
  // whatever arrives while the replay is in flight.
  const wantReplay = true;
  const queued: Uint8Array[] = [];
  let replayPending = wantReplay;
  // Replay computed by the invoke below; it is emitted when the consumer registers
  // onData and calls flushReplay() (if emitted here, dataCbs is empty and it gets lost).
  let pendingReplay: Uint8Array | null = null;
  let historicalReplay = true;
  let replaySize: PtyHandle["replaySize"];

  try {
    unlistenData = await listen<PtyDataEvent>(`pty-data-${sessionId}`, (e) => {
      try {
        const bytes = base64ToUint8Array(e.payload.data);
        if (replayPending) {
          queued.push(bytes);
          return;
        }
        dataCbs.forEach((cb) => {
          try {
            cb(bytes);
          } catch {
            /* callback from closing window */
          }
        });
      } catch {
        /* window closing, ignore */
      }
    });
    debugLog("pty", "listener-data-ok", `sid=${sessionId}`);
  } catch (err) {
    debugLog("pty", "listener-data-failed", `sid=${sessionId} err=${err}`);
    throw err;
  }

  if (wantReplay) {
    try {
      // The first attach must answer startup queries; only later snapshots are history.
      const res = await invoke<
        { data: string; historical: boolean; size?: PtyHandle["replaySize"] | null } | string | null
      >("pty_replay", { sessionId });
      historicalReplay = typeof res === "object" && res !== null ? res.historical : true;
      if (typeof res === "object" && res?.historical && res.size) {
        const { cols, rows } = res.size;
        if (
          Number.isInteger(cols) &&
          cols > 0 &&
          cols <= 65535 &&
          Number.isInteger(rows) &&
          rows > 0 &&
          rows <= 65535
        ) {
          replaySize = { cols, rows };
        }
      }
      pendingReplay = res
        ? base64ToUint8Array(typeof res === "string" ? res : res.data)
        : new Uint8Array(0);
    } catch {
      // replay is best-effort: if it fails, the flush drops the queue as-is
      pendingReplay = null;
    }
  }

  try {
    unlistenExit = await listen<PtyExitEvent>(`pty-exit-${sessionId}`, () => {
      try {
        exitCbs.forEach((cb) => {
          try {
            cb(null);
          } catch {
            /* callback from closing window */
          }
        });
      } catch {
        /* window closing, ignore */
      }
    });
    debugLog("pty", "listener-exit-ok", `sid=${sessionId}`);
  } catch (err) {
    debugLog("pty", "listener-exit-failed", `sid=${sessionId} err=${err}`);
    detach();
    throw err;
  }

  return {
    replaySize,
    async write(data: string) {
      await invoke("pty_write", { sessionId, data });
    },
    /** Injects the backend ring buffer into the stream (call after registering onData). */
    flushReplay() {
      if (!wantReplay || !replayPending) {
        return false;
      }
      replayPending = false;
      const replayBytes = pendingReplay ?? new Uint8Array(0);
      const q = stripReplaySuffix(replayBytes, concatBytes(queued));
      queued.length = 0;
      pendingReplay = null;
      dataCbs.forEach((cb) => {
        try {
          if (replayBytes.length) {
            cb(replayBytes, historicalReplay);
          }
          if (q.length) {
            cb(q);
          }
        } catch {
          /* callback from closing window */
        }
      });
      return replayBytes.length + q.length > 0;
    },
    async resize(cols: number, rows: number) {
      await invoke("pty_resize", { sessionId, cols, rows });
    },
    async kill() {
      await invoke("pty_kill", { sessionId });
    },
    detach,
    onData(cb: (data: Uint8Array, replay?: boolean) => void) {
      dataCbs.push(cb);
    },
    onExit(cb: (code: number | null) => void) {
      exitCbs.push(cb);
    },
  };
}

export { concatBytes, stripReplaySuffix } from "../model/pty-bytes";
