import type { Terminal } from "@xterm/xterm";
import { exitedWithoutOutputMessage, unresponsiveMessage } from "../model/terminal-messages";
import type { TerminalTabProps } from "../model/terminal-options";
type TerminalStatus = Parameters<NonNullable<TerminalTabProps["onStatusChange"]>>[0];

export interface TerminalHealth {
  readonly isDisposed: boolean;
  readonly isPtyAlive: boolean;
  markAttached(): void;
  onDataReceived(): void;
  setStatus(status: TerminalStatus): void;
  schedule(): void;
  onExit(exitCode: number | null): void;
  dispose(): void;
}

interface TerminalHealthOptions extends Pick<
  TerminalTabProps,
  "onStatusChange" | "onRestart" | "isAgent"
> {
  term: Terminal;
  shellFile: string;
  tryOpen: () => boolean;
}
export function createTerminalHealth({
  term,
  shellFile,
  isAgent,
  onStatusChange,
  onRestart,
  tryOpen,
}: TerminalHealthOptions): TerminalHealth {
  const state = {
    disposed: false,
    hasReceivedData: false,
    ptyAlive: true,
    initSettled: false,
    lastStatus: undefined as TerminalStatus | undefined,
    retryCount: 0,
    healthTimer: null as ReturnType<typeof setTimeout> | null,
  };
  const MAX_RETRIES = 3;
  const setStatus = (s: TerminalStatus) => {
    if (state.lastStatus !== s) {
      state.lastStatus = s;
      onStatusChange?.(s);
    }
  };

  const clearHealthTimer = () => {
    if (state.healthTimer) {
      clearTimeout(state.healthTimer);
      state.healthTimer = null;
    }
  };

  // auto-recovery with exponential backoff
  const attemptRecovery = () => {
    if (state.disposed) {
      return;
    }
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      term.write(unresponsiveMessage(MAX_RETRIES));
      setStatus("error");
      return;
    }
    setStatus("reconnecting");
    const delay = Math.pow(2, state.retryCount - 1) * 1000;
    setTimeout(() => {
      if (!state.disposed && !state.hasReceivedData && onRestart) {
        onRestart();
      }
    }, delay);
  };

  // health check at 8s after open (agent binary takes ~2-3s to load)
  const scheduleHealthCheck = () => {
    state.healthTimer = setTimeout(() => {
      if (state.disposed || state.hasReceivedData) {
        return;
      }
      if (!term.buffer?.active) {
        // term.open() never ran — force reopen
        tryOpen();
      }
      if (!state.initSettled) {
        // PTY spawn hung — attempt recovery
        attemptRecovery();
      }
    }, 8000);
  };

  const onExit = (exitCode: number | null) => {
    if (state.disposed) {
      return;
    }
    if (!isAgent) {
      state.ptyAlive = false;
      if (!state.hasReceivedData) {
        term.write(exitedWithoutOutputMessage(shellFile, exitCode));
      } else {
        term.write(`\r\n\x1b[33mProcess exited with code ${exitCode ?? "?"}\x1b[0m\r\n`);
      }
      term.write(`\r\n\x1b[36mProcess exited — click to restart\x1b[0m\r\n`);
      setStatus((exitCode === 0 || exitCode === null) && state.hasReceivedData ? "idle" : "error");
    }
    // For agent sessions: exit is expected between prompts.
    // Reset state so the 8s health check fires for the NEXT session
    // (pty_ensure will recreate on next prompt). Without this, if the
    // recreated agent fails to start, hasReceivedData stays true and
    // the health check never fires → terminal silently dead.
    if (isAgent) {
      state.hasReceivedData = false;
      state.retryCount = 0;
      clearHealthTimer();
      state.healthTimer = setTimeout(() => {
        if (state.disposed || state.hasReceivedData) {
          return;
        }
        if (!state.initSettled) {
          attemptRecovery();
        }
      }, 15000); // 15s — give user time to type next prompt
    }
  };
  return {
    get isDisposed() {
      return state.disposed;
    },
    get isPtyAlive() {
      return state.ptyAlive;
    },
    markAttached: () => {
      state.initSettled = true;
    },
    onDataReceived: () => {
      clearHealthTimer();
      state.hasReceivedData = true;
      setStatus("running");
    },
    setStatus,
    schedule: scheduleHealthCheck,
    onExit,
    dispose: () => {
      state.disposed = true;
      clearHealthTimer();
    },
  };
}
