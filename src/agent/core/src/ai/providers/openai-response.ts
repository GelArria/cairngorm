import type { ChatCompletionChunk } from "openai/resources/chat/completions.js";
import type { AssistantMessage, StopReason } from "../types.js";

export function parseChunkUsage(raw: any): AssistantMessage["usage"] {
  const prompt = raw.prompt_tokens || 0;
  const completion = raw.completion_tokens || 0;
  const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? 0;
  const cacheWrite = raw.prompt_tokens_details?.cache_write_tokens ?? 0;
  const input = Math.max(0, prompt - cacheRead - cacheWrite);
  const totalTokens = input + completion + cacheRead + cacheWrite;
  return {
    input,
    output: completion,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"]): {
  stopReason: StopReason;
  errorMessage?: string;
} {
  if (!reason) {
    return { stopReason: "stop" };
  }
  switch (reason) {
    case "stop":
      return { stopReason: "stop" };
    case "length":
      return { stopReason: "length" };
    case "tool_calls":
      return { stopReason: "toolUse" };
    case "content_filter":
      return { stopReason: "error", errorMessage: "Provider content_filter" };
    default:
      return { stopReason: "error", errorMessage: "Provider finish_reason: " + reason };
  }
}
