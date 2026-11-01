import OpenAI from "openai";
import type { Context, Model, TextContent, ToolCall } from "../types.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";

export interface Compat {
  supportsStore: boolean;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  supportsUsageInStreaming: boolean;
  maxTokensField: string;
  thinkingFormat: string;
}

export function getCompat(model: Model<"openai-completions">): Compat {
  const d: Compat = {
    supportsStore: true,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    maxTokensField: "max_completion_tokens",
    thinkingFormat: "openai",
  };
  return model.compat
    ? {
        supportsStore: model.compat.supportsStore ?? d.supportsStore,
        supportsDeveloperRole: model.compat.supportsDeveloperRole ?? d.supportsDeveloperRole,
        supportsReasoningEffort: model.compat.supportsReasoningEffort ?? d.supportsReasoningEffort,
        supportsUsageInStreaming:
          model.compat.supportsUsageInStreaming ?? d.supportsUsageInStreaming,
        maxTokensField: model.compat.maxTokensField ?? d.maxTokensField,
        thinkingFormat: model.compat.thinkingFormat ?? d.thinkingFormat,
      }
    : d;
}

export function createClient(
  apiKey: string,
  model: Model<"openai-completions">,
  headers?: Record<string, string>,
): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { ...model.headers, ...headers },
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
}

export function convertMessages(
  context: Context,
  compatCfg: Compat,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: any = [];
  if (context.systemPrompt) {
    out.push({
      role: compatCfg.supportsDeveloperRole ? ("developer" as any) : "system",
      content: sanitizeSurrogates(context.systemPrompt),
    });
  }
  for (const msg of context.messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        out.push({ role: "user", content: sanitizeSurrogates(msg.content) });
      } else {
        const t = msg.content
          .filter((c) => c.type === "text")
          .map((c: TextContent) => c.text)
          .join("\n");
        if (t) {
          out.push({ role: "user", content: t });
        }
      }
    } else if (msg.role === "assistant") {
      const t = msg.content
        .filter((c) => c.type === "text")
        .map((c: TextContent) => c.text)
        .join("\n");
      const tc = msg.content.filter((c) => c.type === "toolCall").map((c) => c as ToolCall);
      const m: any = { role: "assistant", content: t || null };
      if (tc.length > 0) {
        m.tool_calls = tc.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        }));
      }
      out.push(m);
    } else if (msg.role === "toolResult") {
      const t = (msg as any).content
        .filter((c: any) => c.type === "text")
        .map((c: TextContent) => c.text)
        .join("\n");
      out.push({
        role: "tool",
        content: t || "(result)",
        tool_call_id: (msg as any).toolCallId,
      } as any);
    }
  }
  return out;
}

export function buildParams(
  model: Model<"openai-completions">,
  context: Context,
  options: any,
  compat: Compat,
): any {
  const messages = convertMessages(context, compat);
  const p: any = { model: model.id, messages, stream: true };
  if (context.tools && context.tools.length > 0) {
    p.tools = context.tools.map((t: any) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        strict: false,
      },
    }));
  }
  if (options?.maxTokens) {
    if (compat.maxTokensField === "max_tokens") {
      p.max_tokens = options.maxTokens;
    } else {
      p.max_completion_tokens = options.maxTokens;
    }
  }
  if (typeof options?.temperature === "number") {
    p.temperature = options.temperature;
  }
  if (options?.reasoning && model.reasoning && compat.supportsReasoningEffort) {
    p.reasoning_effort = (model.thinkingLevelMap as any)?.[options.reasoning] ?? options.reasoning;
  }
  if (compat.supportsUsageInStreaming !== false) {
    p.stream_options = { include_usage: true };
  }
  if (compat.supportsStore) {
    p.store = false;
  }
  return p;
}
