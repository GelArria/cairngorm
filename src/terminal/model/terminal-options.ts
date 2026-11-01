import type { Terminal } from "@xterm/xterm";
import type { RefObject } from "preact";
import type { PtyHandle } from "../data/pty-manager";
export interface TerminalTabProps {
  active?: boolean;
  sessionId: string;
  projectId?: string;
  shellPath?: string;
  shellArgs?: string[];
  shellEnv?: Record<string, string>;
  cwd?: string;
  isAgent?: boolean;
  onStatusChange?: (status: "running" | "idle" | "error" | "reconnecting") => void;
  onRestart?: () => void;
}

export interface TerminalRuntimeOptions extends TerminalTabProps {
  onReady?: () => void;
  termRef: RefObject<HTMLDivElement>;
  xtermRef: RefObject<Terminal>;
  ptyRef: RefObject<PtyHandle>;
  activeRef: RefObject<boolean>;
}
