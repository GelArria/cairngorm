import { TerminalTabs } from "./terminal-tabs";

/** Chat area = TerminalTabs; the TUI/Chat UI toggle is per split pane now
 * (terminal-tabs.tsx) — no more global mode that shows one session fullscreen. */
export function ChatView() {
  return <TerminalTabs />;
}
