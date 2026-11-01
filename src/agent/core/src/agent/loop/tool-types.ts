import type { ToolResultMessage } from "../../ai/types.js";
import type { AgentTool, AgentToolCall, AgentToolResult } from "../types.js";

export type ExecutedToolCallBatch = {
  messages: ToolResultMessage[];
  terminate: boolean;
};

export type PreparedToolCall = {
  kind: "prepared";
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
};

export type ImmediateToolCallOutcome = {
  kind: "immediate";
  result: AgentToolResult<any>;
  isError: boolean;
};

export type ExecutedToolCallOutcome = {
  result: AgentToolResult<any>;
  isError: boolean;
};

export type FinalizedToolCallOutcome = {
  toolCall: AgentToolCall;
  result: AgentToolResult<any>;
  isError: boolean;
};

export type FinalizedToolCallEntry =
  | FinalizedToolCallOutcome
  | (() => Promise<FinalizedToolCallOutcome>);
