/**
 * Agent event types emitted by the Rust JSONL parser as `agent-event`.
 * Mirrors the discriminated union from src/agent/core/src/agent/types.ts.
 */

// ── Event payloads ──────────────────────────────────────────────────────────

export interface AgentEventBase {
  session_id: string;
  timestamp?: number;
}

export interface AgentStartEvent extends AgentEventBase {
  type: "agent_start";
}

export interface AgentEndEvent extends AgentEventBase {
  type: "agent_end";
  messages: AgentMessageLite[];
}

export interface TurnStartEvent extends AgentEventBase {
  type: "turn_start";
}

export interface TurnEndEvent extends AgentEventBase {
  type: "turn_end";
  message: AgentMessageLite;
  toolResults?: ToolResultLite[];
}

export interface MessageStartEvent extends AgentEventBase {
  type: "message_start";
  message: AgentMessageLite;
}

export interface MessageUpdateEvent extends AgentEventBase {
  type: "message_update";
  message: AgentMessageLite;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
    contentIndex?: number;
  };
}

export interface MessageEndEvent extends AgentEventBase {
  type: "message_end";
  message: AgentMessageLite;
}

export interface ToolExecutionStartEvent extends AgentEventBase {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolExecutionUpdateEvent extends AgentEventBase {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: unknown;
  partialResult: unknown;
}

export interface ToolExecutionEndEvent extends AgentEventBase {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export type AgentEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent;

// ── Lite message types (subset of src/agent/core types) ─────────────────────

export interface TextContent {
  type: "text";
  text: string;
}
export interface ImageContent {
  type: "image";
  source: { type: "base64"; data: string; mediaType: string };
}
export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ContentBlock = TextContent | ImageContent | ToolCallContent;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost?: { input: number; output: number; total: number };
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface AssistantMessageLite {
  role: "assistant";
  content: ContentBlock[];
  model?: string;
  usage?: Usage;
  stopReason?: StopReason;
  timestamp: number;
}

export interface ToolResultMessageLite {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  details?: unknown;
  isError?: boolean;
  timestamp: number;
}

export interface UserMessageLite {
  role: "user";
  content: TextContent[];
  timestamp: number;
}

export type AgentMessageLite = AssistantMessageLite | ToolResultMessageLite | UserMessageLite;

export interface ToolResultLite {
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  isError: boolean;
}

// ── UI types (unchanged) ────────────────────────────────────────────────────

export interface AgentSessionState {
  status: "idle" | "running" | "ended";
  startedAt?: number;
  endedAt?: number;
}

export type ChatViewMode = "tui" | "chat";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolStatus?: "running" | "ended";
  toolCallId?: string;
  timestamp: number;
}
