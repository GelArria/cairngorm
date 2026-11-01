import { invoke } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";
import { attachPty } from "../data/pty-manager";
import { clearScrollback, loadScrollback } from "../data/scrollback-store";
import { agentEnvironment, needsEngineEnvironment } from "../data/session-launch";
import { debugLog } from "../data/terminal-debug-logger";
import { attachFailedMessage } from "../model/terminal-messages";
import type { TerminalHealth } from "./terminal-health";
import { writeTerminalReplay } from "./terminal-replay";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import type { RefObject } from "preact";
import type { PtyHandle } from "../data/pty-manager";
import type { TerminalRuntimeOptions } from "../model/terminal-options";
import { terminalHome } from "./terminal-home";
interface TerminalAttachmentOptions extends Pick<
  TerminalRuntimeOptions,
  "sessionId" | "cwd" | "isAgent" | "onReady"
> {
  term: Terminal;
  fitAddon: FitAddon;
  ptyRef: RefObject<PtyHandle>;
  activeRef: RefObject<boolean>;
  shellFile: string;
  finalArgs: string[];
  environment: { value?: Record<string, string> };
  health: TerminalHealth;
  hasWidth: () => boolean;
}
const pendingAttachments = new Set<{ cancelled: boolean; settled: Promise<void> }>();

/** A detached close must settle pending starts before killing its PTYs. */
export async function cancelPendingTerminalAttachments(): Promise<void> {
  const pending = [...pendingAttachments];
  for (const attachment of pending) {
    attachment.cancelled = true;
  }
  await Promise.all(pending.map((attachment) => attachment.settled));
}

/** Restore output only after listeners are registered; live data remains authoritative. */
export async function attachTerminalSession({
  term,
  fitAddon,
  ptyRef,
  activeRef,
  sessionId,
  shellFile,
  finalArgs,
  environment,
  cwd,
  isAgent,
  health,
  hasWidth,
  onReady,
}: TerminalAttachmentOptions) {
  const { setStatus } = health;
  let savedScrollback: string | undefined;
  let settle!: () => void;
  const attachment = {
    cancelled: false,
    settled: new Promise<void>((resolve) => {
      settle = resolve;
    }),
  };
  pendingAttachments.add(attachment);
  const cancelled = () => health.isDisposed || attachment.cancelled;

  debugLog("terminal-tab", "pty-attach-start", `sid=${sessionId}`);
  try {
    const home =
      terminalHome.value ??
      (await invoke<string>("detect_home").catch(() => undefined as string | undefined));
    console.log("[terminal-tab] home:", home);
    if (!terminalHome.value && home) {
      terminalHome.value = home;
    }
    if (cancelled()) {
      return;
    }

    if (!isAgent) {
      savedScrollback = await loadScrollback(sessionId);
    }
    if (cancelled()) {
      return;
    }
    if (isAgent && needsEngineEnvironment(finalArgs, environment.value)) {
      environment.value = await agentEnvironment(finalArgs);
    }
    if (cancelled()) {
      return;
    }
    const pty = await attachPty({
      sessionId: sessionId,
      shellPath: shellFile,
      shellArgs: finalArgs,
      shellEnv: environment.value,
      cwd: cwd ?? home,
      isAgent: isAgent,
    });
    if (cancelled()) {
      pty.detach();
      return;
    }
    debugLog(
      "terminal-tab",
      "pty-attached",
      `sid=${sessionId} cols=${term.cols} rows=${term.rows}`,
    );
    ptyRef.current = pty;
    health.markAttached();

    pty.onData((data: Uint8Array, replay = false) => {
      if (health.isDisposed) {
        return;
      }
      health.onDataReceived();
      if (replay) {
        writeTerminalReplay(term, data);
      } else {
        term.write(data);
      }
    });

    pty.onExit((code) => {
      health.onExit(code);
      onReady?.();
    });

    // Sync initial size with PTY
    if (hasWidth()) {
      fitAddon.fit();
      pty.resize(term.cols, term.rows);
    } else if (!isAgent && pty.replaySize) {
      // Hidden panes cannot fit yet; preserve the PTY geometry while parsing history.
      term.resize(pty.replaySize.cols, pty.replaySize.rows);
    }

    // Replay of the agent history (hot attach / reattach):
    // after registering onData, so the ring buffer reaches the xterm.
    // Live output is authoritative (also for agents resumed in hidden projects).
    // Only fall back to local scrollback when the backend has no output.
    if (!pty.flushReplay() && savedScrollback) {
      writeTerminalReplay(term, savedScrollback);
    }
    if (savedScrollback) {
      clearScrollback(sessionId);
    }

    if (activeRef.current && document.activeElement?.getAttribute("role") !== "tab") {
      term.focus();
    }
    setStatus("running");
  } catch (err) {
    debugLog("terminal-tab", "pty-attach-error", `sid=${sessionId} err=${err}`);
    if (!cancelled()) {
      term.write(attachFailedMessage(shellFile, err));
      setStatus("error");
      onReady?.();
    }
  } finally {
    pendingAttachments.delete(attachment);
    settle();
  }
}
