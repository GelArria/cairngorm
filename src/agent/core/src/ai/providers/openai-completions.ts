import { registerApiProvider } from "../api-registry.js";
import { getEnvApiKey } from "../env-api-keys.js";
import type { AssistantMessage, StreamFunction, ToolCall } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { buildParams, createClient, getCompat } from "./openai-request.js";
import { mapStopReason, parseChunkUsage } from "./openai-response.js";
import { websocketChunks } from "./openai-websocket.js";
import { providerEndpoint } from "./provider-endpoint.js";

export const streamOpenAICompletions: StreamFunction<"openai-completions"> = function (
  model,
  context,
  options,
): AssistantMessageEventStream {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
  if (!apiKey) {
    throw new Error("No API key for provider: " + model.provider);
  }
  const compat = getCompat(model);
  const websocket = ["ws:", "wss:"].includes(providerEndpoint(model.baseUrl).protocol);
  const client = websocket ? undefined : createClient(apiKey, model, options?.headers);
  const params: any = buildParams(model, context, options, compat);
  const stream = new AssistantMessageEventStream();
  void (async () => {
    const out: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    stream.push({ type: "start", partial: out });
    try {
      const requestOptions: any = {
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(typeof options?.timeoutMs === "number" ? { timeout: options.timeoutMs } : {}),
        ...(typeof options?.maxRetries === "number" ? { maxRetries: options.maxRetries } : {}),
      };
      const chunks = websocket
        ? websocketChunks(model.baseUrl, apiKey, params, {
            ...options,
            headers: { ...model.headers, ...options?.headers },
          })
        : ((await client!.chat.completions.create(params, requestOptions).withResponse())
            .data as unknown as AsyncIterable<any>);
      let hasFinishReason = false;
      let textBlock: any, thinkingBlock: any;
      type StreamingToolCall = ToolCall & { partialArgs?: string; streamIndex?: number };
      const blocks = out.content as any[];
      const toolCallsByIndex = new Map<number, StreamingToolCall>(),
        toolCallsById = new Map<string, StreamingToolCall>();
      const contentIndexOf = (b: any) => blocks.indexOf(b);
      const finalizeBlock = (b: any) => {
        const i = contentIndexOf(b);
        if (i < 0) {
          return;
        }
        if (b.type === "text") {
          stream.push({ type: "text_end", contentIndex: i, content: b.text, partial: out });
        } else if (b.type === "thinking") {
          stream.push({ type: "thinking_end", contentIndex: i, content: b.thinking, partial: out });
        } else if (b.type === "toolCall") {
          b.arguments = parseStreamingJson(b.partialArgs || "{}");
          delete b.partialArgs;
          delete b.streamIndex;
          stream.push({ type: "toolcall_end", contentIndex: i, toolCall: b, partial: out });
        }
      };
      const getOrCreateTextBlock = () => {
        if (!textBlock) {
          textBlock = { type: "text", text: "" };
          blocks.push(textBlock);
          stream.push({
            type: "text_start",
            contentIndex: contentIndexOf(textBlock),
            partial: out,
          });
        }
        return textBlock;
      };
      const getOrCreateThinkingBlock = (sig: string) => {
        if (!thinkingBlock) {
          thinkingBlock = { type: "thinking", thinking: "", thinkingSignature: sig };
          blocks.push(thinkingBlock);
          stream.push({
            type: "thinking_start",
            contentIndex: contentIndexOf(thinkingBlock),
            partial: out,
          });
        }
        return thinkingBlock;
      };
      const getOrCreateToolCallBlock = (d: any): StreamingToolCall => {
        const sIdx = typeof d.index === "number" ? d.index : undefined;
        let b = sIdx !== undefined ? toolCallsByIndex.get(sIdx) : undefined;
        if (!b && d.id) {
          b = toolCallsById.get(d.id);
        }
        if (!b) {
          b = {
            type: "toolCall",
            id: d.id || "",
            name: d.function?.name || "",
            arguments: {},
            partialArgs: "",
            streamIndex: sIdx,
          } as StreamingToolCall;
          if (sIdx !== undefined) {
            toolCallsByIndex.set(sIdx, b);
          }
          if (d.id) {
            toolCallsById.set(d.id, b);
          }
          blocks.push(b);
          stream.push({ type: "toolcall_start", contentIndex: contentIndexOf(b), partial: out });
        }
        if (sIdx !== undefined && b.streamIndex === undefined) {
          b.streamIndex = sIdx;
          toolCallsByIndex.set(sIdx, b);
        }
        if (d.id) {
          toolCallsById.set(d.id, b);
        }
        return b;
      };
      for await (const chunk of chunks) {
        if (!chunk || typeof chunk !== "object") {
          continue;
        }
        if (chunk.usage) {
          out.usage = parseChunkUsage(chunk.usage);
        }
        const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
        if (!choice) {
          continue;
        }
        if (choice.finish_reason) {
          const r = mapStopReason(choice.finish_reason);
          out.stopReason = r.stopReason;
          out.errorMessage = r.errorMessage;
          hasFinishReason = true;
        }
        const delta = choice.delta || {};
        if (delta.content) {
          const b = getOrCreateTextBlock();
          b.text += delta.content;
          stream.push({
            type: "text_delta",
            contentIndex: contentIndexOf(b),
            delta: delta.content,
            partial: out,
          });
        }
        for (const f of ["reasoning_content", "reasoning", "reasoning_text"]) {
          const v = (delta as any)[f];
          if (typeof v === "string" && v.length > 0) {
            const b = getOrCreateThinkingBlock(f);
            b.thinking += v;
            stream.push({
              type: "thinking_delta",
              contentIndex: contentIndexOf(b),
              delta: v,
              partial: out,
            });
            break;
          }
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!tc) {
              continue;
            }
            const b = getOrCreateToolCallBlock(tc);
            if (!b.id && tc.id) {
              b.id = tc.id;
              toolCallsById.set(tc.id, b);
            }
            if (!b.name && tc.function?.name) {
              b.name = tc.function.name;
            }
            const a = tc.function?.arguments || "";
            if (a) {
              b.partialArgs = (b.partialArgs || "") + a;
              b.arguments = parseStreamingJson(b.partialArgs);
            }
            stream.push({
              type: "toolcall_delta",
              contentIndex: contentIndexOf(b),
              delta: a,
              partial: out,
            });
          }
        }
      }
      for (const b of blocks) {
        finalizeBlock(b);
      }
      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }
      if (out.stopReason === "aborted") {
        throw new Error("Request was aborted");
      }
      if (out.stopReason === "error") {
        throw new Error(out.errorMessage || "Provider returned an error stop reason");
      }
      if (!hasFinishReason) {
        throw new Error("Stream ended without finish_reason");
      }
      stream.push({ type: "done", reason: out.stopReason, message: out });
      stream.end();
    } catch (err) {
      for (const b of out.content as any[]) {
        delete b.partialArgs;
        delete b.streamIndex;
      }
      out.stopReason = options?.signal?.aborted ? "aborted" : "error";
      out.errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
      stream.push({ type: "error", reason: out.stopReason, error: out });
      stream.end();
    }
  })();
  return stream;
};

export const streamSimpleOpenAICompletions: StreamFunction<"openai-completions"> = function (
  model,
  context,
  options,
): AssistantMessageEventStream {
  const apiKey = options?.apiKey || getEnvApiKey(model.provider);
  if (!apiKey) {
    throw new Error("No API key for provider: " + model.provider);
  }
  return streamOpenAICompletions(model, context, { ...options, apiKey });
};

registerApiProvider({
  api: "openai-completions",
  stream: streamOpenAICompletions,
  streamSimple: streamSimpleOpenAICompletions,
});
