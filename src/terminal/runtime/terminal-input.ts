import { catchLog } from "@/debug/data/safe";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { type PtyHandle } from "../data/pty-manager";

import type { RefObject } from "preact";
interface TerminalInputOptions {
  term: Terminal;
  ptyRef: RefObject<PtyHandle>;
  activeRef: RefObject<boolean>;
  sessionId: string;
  shellFile: string;
  finalArgs: string[];
  cwd?: string;
  isAgent?: boolean;
  isDisposed: () => boolean;
  isAlive: () => boolean;
  getHome: () => string | undefined;
  getEnvironment: () => Record<string, string> | undefined;
}
export function registerTerminalInput({
  term,
  ptyRef,
  activeRef,
  sessionId,
  shellFile,
  finalArgs,
  cwd,
  isAgent,
  isDisposed,
  isAlive,
  getHome,
  getEnvironment,
}: TerminalInputOptions) {
  if (isAgent) {
    // Agent sidecar: accumulate keystrokes, send as JSONL prompt on Enter
    let lineBuf = "";
    term.onData((data) => {
      if (isDisposed() || !ptyRef.current) {
        return;
      }
      for (const ch of data) {
        if (ch === "\r" || ch === "\n") {
          if (lineBuf.trim()) {
            const cmd = JSON.stringify({ type: "prompt", content: lineBuf }) + "\n";
            // pty_ensure recreates session if child died between prompts
            invoke("pty_ensure", {
              sessionId,
              shell: shellFile,
              args: finalArgs,
              cwd: cwd ?? getHome() ?? null,
              env: getEnvironment() ? Object.entries(getEnvironment()!) : [],
              parseJsonl: true,
              killOnAgentEnd: false,
            })
              .then(() => ptyRef.current?.write(cmd))
              .catch(catchLog("terminal"));
            term.write("\r\n");
          }
          lineBuf = "";
        } else if (ch === "\u007f" || ch === "\b") {
          if (lineBuf.length > 0) {
            lineBuf = lineBuf.slice(0, -1);
            term.write("\b \b");
          }
        } else if (ch === "\u0003") {
          // Ctrl+C — send steer to stop agent
          const cmd = JSON.stringify({ type: "steer", instruction: "stop", mode: "stop" }) + "\n";
          ptyRef.current?.write(cmd).catch(() => {});
          lineBuf = "";
          term.write("^C\r\n");
        } else if (ch >= " ") {
          lineBuf += ch;
          term.write(ch);
        }
      }
    });
  } else {
    // Regular terminal: forward raw bytes
    term.onData((data) => {
      if (!isDisposed() && isAlive() && ptyRef.current) {
        ptyRef.current.write(data).catch(catchLog("terminal"));
      }
    });
  }
  term.onResize(({ cols, rows }) => {
    if (!isDisposed() && isAlive() && ptyRef.current) {
      ptyRef.current.resize(cols, rows).catch(catchLog("terminal"));
    }
  });
  if (activeRef.current && document.activeElement?.getAttribute("role") !== "tab") {
    term.focus();
  }
}
