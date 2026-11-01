import type { Agent } from "./agent.js";
import type { AgentLoopConfig, AgentMessage } from "./types.js";
interface MessageQueues {
  steering: () => AgentMessage[];
  followUp: () => AgentMessage[];
}
/** Read current agent settings for each run while preserving live queue callbacks. */
export function createLoopConfig(
  agent: Agent,
  queues: MessageQueues,
  options: { skipInitialSteeringPoll?: boolean } = {},
): AgentLoopConfig {
  let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
  return {
    model: agent.state.model,
    reasoning: agent.state.thinkingLevel === "off" ? undefined : agent.state.thinkingLevel,
    sessionId: agent.sessionId,
    onPayload: agent.onPayload,
    onResponse: agent.onResponse,
    transport: agent.transport,
    thinkingBudgets: agent.thinkingBudgets,
    maxRetryDelayMs: agent.maxRetryDelayMs,
    toolExecution: agent.toolExecution,
    beforeToolCall: agent.beforeToolCall,
    afterToolCall: agent.afterToolCall,
    prepareNextTurn: agent.prepareNextTurn
      ? async () => await agent.prepareNextTurn?.(agent.signal)
      : undefined,
    convertToLlm: agent.convertToLlm,
    transformContext: agent.transformContext,
    getApiKey: agent.getApiKey,
    getSteeringMessages: async () => {
      if (skipInitialSteeringPoll) {
        skipInitialSteeringPoll = false;
        return [];
      }
      return queues.steering();
    },
    getFollowUpMessages: async () => queues.followUp(),
  };
}
