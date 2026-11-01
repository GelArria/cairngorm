import type { AssistantMessage, ToolResultMessage } from "../../ai/types.js";
import type { AgentContext, AgentLoopConfig, AgentToolCall } from "../types.js";
import { type AgentEventSink } from "./event-sink.js";
import { executePreparedToolCall, prepareToolCall } from "./tool-call.js";
import {
  createToolResultMessage,
  emitToolExecutionEnd,
  emitToolResultMessage,
  finalizeExecutedToolCall,
  shouldTerminateToolBatch,
} from "./tool-results.js";
import {
  type ExecutedToolCallBatch,
  type FinalizedToolCallEntry,
  type FinalizedToolCallOutcome,
} from "./tool-types.js";

interface ToolExecutionContext {
  currentContext: AgentContext;
  assistantMessage: AssistantMessage;
  config: AgentLoopConfig;
  signal: AbortSignal | undefined;
  emit: AgentEventSink;
}

interface ToolBatchContext extends ToolExecutionContext {
  toolCalls: AgentToolCall[];
}

/**
 * Execute tool calls from an assistant message.
 */
export async function executeToolCalls(
  context: ToolExecutionContext,
): Promise<ExecutedToolCallBatch> {
  const { currentContext, assistantMessage, config } = context;
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
  const batch = { ...context, toolCalls };
  const hasSequentialToolCall = toolCalls.some(
    (tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
  );
  if (config.toolExecution === "sequential" || hasSequentialToolCall) {
    return executeToolCallsSequential(batch);
  }
  return executeToolCallsParallel(batch);
}

export async function executeToolCallsSequential({
  currentContext,
  assistantMessage,
  toolCalls,
  config,
  signal,
  emit,
}: ToolBatchContext): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallOutcome[] = [];
  const messages: ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal,
    );
    let finalized: FinalizedToolCallOutcome;
    if (preparation.kind === "immediate") {
      finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      };
    } else {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal,
      );
    }

    await emitToolExecutionEnd(finalized, emit);
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    finalizedCalls.push(finalized);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(finalizedCalls),
  };
}

export async function executeToolCallsParallel({
  currentContext,
  assistantMessage,
  toolCalls,
  config,
  signal,
  emit,
}: ToolBatchContext): Promise<ExecutedToolCallBatch> {
  const finalizedCalls: FinalizedToolCallEntry[] = [];

  for (const toolCall of toolCalls) {
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(
      currentContext,
      assistantMessage,
      toolCall,
      config,
      signal,
    );
    if (preparation.kind === "immediate") {
      const finalized = {
        toolCall,
        result: preparation.result,
        isError: preparation.isError,
      } satisfies FinalizedToolCallOutcome;
      await emitToolExecutionEnd(finalized, emit);
      finalizedCalls.push(finalized);
      continue;
    }

    finalizedCalls.push(async () => {
      const executed = await executePreparedToolCall(preparation, signal, emit);
      const finalized = await finalizeExecutedToolCall(
        currentContext,
        assistantMessage,
        preparation,
        executed,
        config,
        signal,
      );
      await emitToolExecutionEnd(finalized, emit);
      return finalized;
    });
  }

  const orderedFinalizedCalls = await Promise.all(
    finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
  );
  const messages: ToolResultMessage[] = [];
  for (const finalized of orderedFinalizedCalls) {
    const toolResultMessage = createToolResultMessage(finalized);
    await emitToolResultMessage(toolResultMessage, emit);
    messages.push(toolResultMessage);
  }

  return {
    messages,
    terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
  };
}
