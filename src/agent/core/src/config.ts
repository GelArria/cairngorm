import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AgentConfig {
  provider: string;
  model: string;
  apiKeyEnv: string;
  baseUrl: string;
  profiles: Record<string, string>;
  defaultProfile: string;
  toolExecution: "sequential" | "parallel";
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high";
  allowShell?: boolean;
}

const DEFAULT_PROFILES: Record<string, string> = {
  "code-assistant":
    "You are a coding assistant. Help write, debug, and refactor code. Use tools to read and write files.",
  "infra-engineer":
    "You are an infrastructure engineer. Help with deployments, configs, and DevOps tasks.",
  "data-analyst":
    "You are a data analyst. Help analyze data, write queries, and create visualizations.",
  "security-auditor":
    "You are a security auditor. Help identify vulnerabilities and review code for security issues.",
  "product-strategist":
    "You are a product strategist. Help with planning, roadmaps, and feature decisions.",
};

export function getConfigDir(): string {
  const envDir = process.env.CAIRNGORM_AGENT_DIR || process.env.PANEL_AGENT_DIR;
  if (envDir) {
    return envDir;
  }
  return join(homedir(), ".panel", "agent");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export const DEFAULT_CONFIG: AgentConfig = {
  provider: "openai",
  model: "",
  apiKeyEnv: "OPENAI_API_KEY",
  baseUrl: "",
  profiles: { ...DEFAULT_PROFILES },
  defaultProfile: "code-assistant",
  toolExecution: "parallel",
  thinkingLevel: "off",
};

export function loadConfig(): AgentConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw, profiles: { ...DEFAULT_PROFILES, ...raw.profiles } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function ensureConfig(): AgentConfig {
  const dir = getConfigDir();
  const path = getConfigPath();

  if (existsSync(path)) {
    return loadConfig();
  }

  mkdirSync(dirname(path), { recursive: true });

  // Never select a provider or import another app's credentials on first run.
  const config = { ...DEFAULT_CONFIG };
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return config;
}
