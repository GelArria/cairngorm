import "@xterm/xterm/css/xterm.css";
import { subscribeFontSize } from "../data/font-zoom";
import { saveScrollback, SCROLLBACK_LIMIT } from "../data/scrollback-store";
import { DEFAULT_SHELL } from "../data/session-launch";
import { debugLog } from "../data/terminal-debug-logger";
import { registerTerm, unregisterTerm } from "./term-registry";
import { attachTerminalSession } from "./terminal-attachment";
import { createTerminalHealth } from "./terminal-health";
import { terminalHome } from "./terminal-home";

import type { TerminalRuntimeOptions } from "../model/terminal-options";
import { registerTerminalInput } from "./terminal-input";
import { createTerminalSurface } from "./terminal-surface";
import { createTerminalWebgl } from "./terminal-webgl";

/** Own one mounted terminal: attachment, recovery, visibility and disposal. */
export function mountTerminal({
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
  onReady,
}: TerminalRuntimeOptions) {
  if (!termRef.current) {
    return;
  }

  const { term, fitAddon, serializeAddon, mouseEncoding, disposePreferences } =
    createTerminalSurface();
  xtermRef.current = term;
  registerTerm(sessionId, term);

  const shellFile = shellPath ?? DEFAULT_SHELL.file;
  const finalArgs = shellArgs?.length ? shellArgs : shellPath ? [] : DEFAULT_SHELL.args;
  debugLog(
    "terminal-tab",
    "mount",
    `sid=${sessionId} shell=${shellFile} args=${finalArgs.join(",")} hasEnv=${!!shellEnv}`,
  );

  const environment = { value: shellEnv };

  // Ctrl + / - / 0 font zoom (shared with Chat UI): live option change + refit
  const unsubscribeZoom = subscribeFontSize((fs) => {
    term.options.fontSize = fs;
    requestAnimationFrame(() => {
      if (!health.isDisposed) {
        fitAddon.fit();
      }
    });
  });

  const hasWidth = () => (termRef.current?.offsetWidth ?? 0) > 0;
  const health = createTerminalHealth({
    term,
    shellFile,
    isAgent,
    onStatusChange,
    onRestart,
    tryOpen: () => tryOpen(),
  });

  // tryOpen with canvas verification
  const tryOpen = (): boolean => {
    if (health.isDisposed || !termRef.current) {
      return false;
    }
    term.open(termRef.current);
    if (hasWidth()) {
      fitAddon.fit();
    }
    // Verify terminal rendered (xterm v6 uses DOM rows, not canvas by default)
    const rows = termRef.current.querySelector(".xterm-rows");
    if (!rows) {
      return false;
    }
    return true;
  };

  let openCancelled = false;
  let startupFinished = false;
  const finishStartup = () => {
    if (health.isDisposed || startupFinished) {
      return;
    }
    startupFinished = true;
    startupOutput.dispose();
    onReady?.();
  };
  // ANSI setup/query bytes do not mean the agent has drawn its first screen.
  const startupOutput = term.onWriteParsed(() => {
    const buffer = term.buffer.active;
    for (let row = buffer.viewportY; row < buffer.viewportY + term.rows; row++) {
      if (buffer.getLine(row)?.translateToString(true).trim()) {
        finishStartup();
        return;
      }
    }
  });

  // Startup query replies can arrive before the first render frame.
  registerTerminalInput({
    term,
    ptyRef,
    activeRef,
    sessionId,
    shellFile,
    finalArgs,
    cwd,
    isAgent,
    isDisposed: () => health.isDisposed,
    isAlive: () => health.isPtyAlive,
    getHome: () => terminalHome.value,
    getEnvironment: () => environment.value,
  });

  const openTerminal = () => {
    const opened = tryOpen();
    if (opened && activeRef.current && document.activeElement?.getAttribute("role") !== "tab") {
      term.focus();
    }
    return opened;
  };

  // Listen for save-scrollback requests (e.g., before reattach from detached window)
  const saveScrollbackHandler = () => {
    if (health.isDisposed || isAgent) {
      return;
    } // agent tabs: skip scrollback (Chat UI has history)
    try {
      const serialized = serializeAddon.serialize() + mouseEncoding();
      const truncated =
        serialized.length > SCROLLBACK_LIMIT ? serialized.slice(-SCROLLBACK_LIMIT) : serialized;
      saveScrollback(sessionId, truncated);
    } catch {
      /* term may be disposed */
    }
  };
  window.addEventListener("terminal-save-scrollback", saveScrollbackHandler);

  // Listen for PTY detach requests (reattach: stop receiving data before main mounts)
  const detachPtyHandler = () => {
    if (health.isDisposed) {
      return;
    }
    try {
      ptyRef.current?.detach();
    } catch {
      /* already detached */
    }
  };
  window.addEventListener("terminal-detach-pty", detachPtyHandler);

  // Replay can arrive before the first frame; parse it at the pane's real size, not 80x24.
  const opened = hasWidth() && openTerminal();
  requestAnimationFrame(() => {
    if (openCancelled || health.isDisposed || !termRef.current) {
      return;
    }
    if (!opened && !openTerminal()) {
      // Canvas failed — try reopen after brief delay
      setTimeout(() => {
        if (openCancelled || health.isDisposed || !termRef.current) {
          return;
        }
        openTerminal();
      }, 100);
    }
    // verify and enable WebGL after canvas check
    webgl.schedule();
  });

  const webgl = createTerminalWebgl(term, termRef, () => health.isDisposed);

  // MutationObserver for tab visibility
  let mutObserver: MutationObserver | null = null;
  const parentEl = termRef.current.parentElement;
  if (parentEl) {
    mutObserver = new MutationObserver(() => {
      if (health.isDisposed || !hasWidth()) {
        return;
      }
      requestAnimationFrame(() => {
        if (!health.isDisposed) {
          fitAddon.fit();
        }
      });
    });
    mutObserver.observe(parentEl, { attributes: true, attributeFilter: ["style", "class"] });
  }

  health.schedule();

  void attachTerminalSession({
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
    onReady: finishStartup,
  });

  // ResizeObserver — skip fit() when hidden (0 width)
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  const ro = new ResizeObserver(() => {
    if (fitTimer) {
      clearTimeout(fitTimer);
    }
    fitTimer = setTimeout(() => {
      if (hasWidth()) {
        fitAddon.fit();
      }
    }, 50);
  });
  ro.observe(termRef.current);

  // Click handler for restart on exited terminal
  const clickHandler = () => {
    if (!health.isPtyAlive && onRestart) {
      onRestart();
    }
  };
  termRef.current.addEventListener("click", clickHandler);

  return () => {
    health.dispose();
    startupOutput.dispose();
    unsubscribeZoom();
    disposePreferences();
    openCancelled = true;
    ro.disconnect();
    mutObserver?.disconnect();
    if (fitTimer) {
      clearTimeout(fitTimer);
    }
    termRef.current?.removeEventListener("click", clickHandler);
    window.removeEventListener("terminal-save-scrollback", saveScrollbackHandler);
    window.removeEventListener("terminal-detach-pty", detachPtyHandler);
    webgl.dispose();
    // Persist scrollback for detach/attach — skip for agent tabs (ephemeral, Chat UI has history)
    if (!isAgent) {
      try {
        const serialized = serializeAddon.serialize() + mouseEncoding();
        const truncated =
          serialized.length > SCROLLBACK_LIMIT ? serialized.slice(-SCROLLBACK_LIMIT) : serialized;
        saveScrollback(sessionId, truncated);
        debugLog("terminal-tab", "dispose", `sid=${sessionId} scrollback=${truncated.length}`);
      } catch {
        /* term may be disposed */
      }
    }
    try {
      ptyRef.current?.detach();
    } catch {
      /* already detached */
    }
    // Defer term.dispose() to avoid blocking the cleanup path
    unregisterTerm(sessionId, term);
    const termToDispose = term;
    setTimeout(() => {
      try {
        termToDispose.dispose();
      } catch {
        /* already gone */
      }
    }, 0);
    xtermRef.current = null;
    ptyRef.current = null;
  };
}
