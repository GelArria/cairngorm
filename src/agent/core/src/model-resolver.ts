import { getEnvApiKey } from "./ai/env-api-keys.js";
import type { Model, OpenAICompletionsCompat } from "./ai/types.js";
import type { AgentConfig } from "./config.js";

interface ModelDef {
  id: string;
  name: string;
  api: string;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat?: OpenAICompletionsCompat;
}

const PROVIDER_MODELS: Record<string, ModelDef> = {
  openai: {
    id: "gpt-4o",
    name: "GPT-4o",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 2.5 },
    contextWindow: 128000,
    maxTokens: 16384,
  },
  deepseek: {
    id: "deepseek-chat",
    name: "DeepSeek V3",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
    contextWindow: 128000,
    maxTokens: 8192,
    compat: { thinkingFormat: "deepseek" },
  },
  openrouter: {
    id: "openai/gpt-4o",
    name: "OpenRouter GPT-4o",
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 2.5 },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: { thinkingFormat: "openrouter" },
  },
};

export function resolveModel(
  config: AgentConfig,
  override?: string,
): { model: Model<any>; apiKey: string } {
  const def = PROVIDER_MODELS[config.provider];
  const key =
    config.model && config.baseUrl
      ? (process.env.CAIRNGORM_AGENT_API_KEY ??
        process.env[config.apiKeyEnv] ??
        getEnvApiKey(config.provider) ??
        "")
      : "";

  const baseModel = (def ?? PROVIDER_MODELS.openai) as unknown as Model<any>;

  if (override && config.model && config.baseUrl) {
    const match = Object.entries(PROVIDER_MODELS).find(
      ([, m]) => m.id === override || m.name === override,
    );
    if (match) {
      const overrideKey = getEnvApiKey(match[1].provider) ?? "";
      return { model: match[1] as unknown as Model<any>, apiKey: overrideKey };
    }
  }

  // Use config overrides (model ID, baseUrl) on top of provider defaults
  const model: Model<any> = {
    ...baseModel,
    id: config.model,
    baseUrl: config.baseUrl,
  };

  return { model, apiKey: key };
}
