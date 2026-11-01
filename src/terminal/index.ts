// ── Public API ────────────────────────────────────────────────────────────

// Components
export { ChatUIView } from "./components/chat-ui-view";
export { ChatView } from "./components/chat-view";
export { DetachedTerminalView } from "./components/terminal-detached-view";
export { TerminalTabs } from "./components/terminal-tabs";
export {
  buildDetachedUrl,
  closeDetachedWindow,
  detachTerminalWindow,
  focusDetachedWindow,
  getDetachedTabIdFromUrl,
  getDetachedTabInfoFromUrl,
} from "./data/terminal-window";
export type { DetachedPayload, DetachedTabInfo, ReattachPayload } from "./data/terminal-window";

export { legacyTerminalConfig } from "./data/terminal-preferences";

// Hooks
export { useAgentEvents } from "./hooks/use-agent-events";
export { attachGroup, hydrateDetachedGroup, useTerminalTabs } from "./hooks/use-terminal-tabs";

// Types (re-export from shared + lib)
export type {
  AgentEndEvent,
  AgentEvent,
  AgentMessageLite,
  AgentSessionState,
  AgentStartEvent,
  ChatMessage,
  ChatViewMode,
  ContentBlock,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  StopReason,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
  Usage,
} from "./shared/agent-events";

export type { DetectedShell, TermTab, TerminalState, TileCell, TileLayout } from "./model/types";
