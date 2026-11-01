import { invoke } from "@tauri-apps/api/core";
import type { TermTab } from "../model/types";
import { agentShellEnv, type AgentEnvInfo } from "./agent-launch";
import { recordEnsured } from "./launch-permissions";

export const DEFAULT_SHELL = navigator.platform.startsWith("Win")
  ? { file: "powershell.exe", args: [] }
  : navigator.platform.startsWith("Mac")
    ? { file: "/bin/zsh", args: ["-l"] }
    : { file: "/bin/bash", args: ["-l"] };

/** Subscription CLIs the agent sidecar can drive; a tab records its engine as a launch flag. */
const ENGINES = [
  {
    flag: "--codex",
    command: "get_codex_agent_env",
    key: "CAIRNGORM_CODEX_COMMAND",
    name: "Codex",
  },
  {
    flag: "--gemini",
    command: "get_gemini_agent_env",
    key: "CAIRNGORM_GEMINI_COMMAND",
    name: "Gemini CLI",
  },
] as const;

const engineOf = (args?: string[]) => ENGINES.find((engine) => args?.includes(engine.flag));

/** A subscription-engine tab whose launch environment has not been resolved yet. */
export function needsEngineEnvironment(args?: string[], env?: Record<string, string>) {
  const engine = engineOf(args);
  return !!engine && !env?.[engine.key];
}

/** The verified subscription engine, if one is selected: its launch flag and environment. */
export async function selectedEngine() {
  for (const engine of ENGINES) {
    const env = await invoke<Record<string, string> | null>(engine.command);
    if (env) {
      return { flag: engine.flag, env };
    }
  }
  return null;
}

/** Credentials are resolved live, never restored from the workspace snapshot. */
export async function agentEnvironment(args?: string[]): Promise<Record<string, string>> {
  const engine = engineOf(args);
  if (engine) {
    const env = await invoke<Record<string, string> | null>(engine.command);
    if (!env) {
      throw new Error(
        `${engine.name} is no longer selected. Verify it again in AI providers before restoring this agent.`,
      );
    }
    return env;
  }
  return agentShellEnv(await invoke<AgentEnvInfo>("get_agent_env"));
}

/** Restore all projects, including hidden tabs; output stays in Rust's replay ring. */
export async function restoreWorkspaceProcesses(tabs: TermTab[]): Promise<void> {
  const home = await invoke<string>("detect_home").catch(() => undefined);
  // sequential spawn avoids flooding ConPTY at startup; parallelize only if measured slow.
  for (const tab of tabs) {
    if (tab.kind) {
      continue;
    }
    try {
      const env = tab.isAgent ? await agentEnvironment(tab.shellArgs) : tab.shellEnv;
      const ensured = await invoke("pty_ensure", {
        sessionId: tab.sessionId,
        shell: tab.shellPath ?? DEFAULT_SHELL.file,
        args: tab.shellArgs ?? (tab.shellPath ? [] : DEFAULT_SHELL.args),
        cwd: tab.cwd ?? home ?? null,
        env: env ? Object.entries(env) : [],
        parseJsonl: !!tab.isAgent,
        killOnAgentEnd: false,
      });
      recordEnsured(tab.sessionId, ensured);
    } catch (err) {
      console.error("[workspace] could not restore terminal", tab.id, err);
    }
  }
}
