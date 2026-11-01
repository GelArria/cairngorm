// The native PTY launcher resolves credentials; JavaScript receives readiness only.
export interface AgentEnvInfo {
  apiKeyEnv: string;
  keyAvailable: boolean;
  baseUrl: string | null;
  model: string | null;
  provider?: string | null;
}

export class AgentSetupError extends Error {
  constructor(
    public code: "no-key",
    message: string,
  ) {
    super(message);
  }
}

export function agentShellEnv(env: AgentEnvInfo): Record<string, string> {
  if (!env.keyAvailable) {
    throw new AgentSetupError(
      "no-key",
      "No API key for the agent — configure one in Settings › AI providers or its environment variable.",
    );
  }
  return {};
}
