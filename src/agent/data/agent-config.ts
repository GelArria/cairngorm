// BYOK: provider presets + the Tauri commands behind Settings › AI providers. The agent
// talks to any OpenAI-compatible endpoint; a preset only pre-fills the fields.
export interface AgentConfigView {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  /** where the effective key comes from */
  keySource: "saved" | "env" | "none";
  /** last 4 characters of the effective key */
  keyHint: string | null;
}

export interface AgentConfigInput {
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  /** undefined = keep the saved key · "" = remove it · string = save it */
  apiKey?: string;
  /** local server: the agent runs without a real key */
  keyOptional?: boolean;
}

export interface AgentTestResult {
  ok: boolean;
  message: string;
  models: string[];
}

export interface ProviderPreset {
  id: string;
  label: string;
  /** provider id the agent understands (custom endpoints run as "openai") */
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  /** local servers run without a key */
  keyOptional?: boolean;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    provider: "ollama",
    baseUrl: "https://ollama.com/v1",
    model: "gemma4:31b",
    apiKeyEnv: "OLLAMA_API_KEY",
  },
  {
    id: "ollama-local",
    label: "Ollama (local)",
    provider: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    apiKeyEnv: "OLLAMA_API_KEY",
    keyOptional: true,
  },
  {
    id: "custom",
    label: "Custom endpoint (OpenAI-compatible)",
    provider: "openai",
    baseUrl: "",
    model: "",
    apiKeyEnv: "OPENAI_API_KEY",
  },
];

const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

/** The preset a saved config corresponds to (custom when nothing matches). */
export function presetOf(cfg: Pick<AgentConfigView, "provider" | "baseUrl">): ProviderPreset {
  return (
    PRESETS.find(
      (p) =>
        p.id !== "custom" && p.provider === cfg.provider && norm(p.baseUrl) === norm(cfg.baseUrl),
    ) ?? PRESETS[PRESETS.length - 1]
  );
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const getAgentConfig = () => call<AgentConfigView>("get_agent_config");
export const saveAgentConfig = (input: AgentConfigInput) =>
  call<AgentConfigView>("save_agent_config", { input });
/** useSaved=false: test without the saved key (e.g. it is marked for removal) */
export const testAgentConnection = (
  baseUrl: string,
  apiKeyEnv: string,
  apiKey?: string,
  useSaved = true,
  provider?: string,
) =>
  call<AgentTestResult>("test_agent_connection", {
    baseUrl,
    apiKeyEnv,
    apiKey: apiKey || null,
    useSaved,
    provider,
  });
