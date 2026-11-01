import { errorMessage } from "@/common/errors";
import { getActiveProject, whenProjectsReady } from "@/projects/api";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "preact/compat";
import { type InitStatus } from "../components/terminal-empty-state";
import { agentShellEnv, type AgentEnvInfo } from "../data/agent-launch";
import { selectedEngine } from "../data/session-launch";
import { debugLog } from "../data/terminal-debug-logger";
import { useTerminalTabs } from "./use-terminal-tabs";

export function useAgentLaunch(openTab: ReturnType<typeof useTerminalTabs>["openTab"]) {
  const agentStarting = useRef(false);
  const [initStatus, setInitStatus] = useState<InitStatus>("ready");
  const [initError, setInitError] = useState("");
  const spawnAgent = useCallback(async () => {
    // The agent starts in the active project's folder (its group cwd)
    await whenProjectsReady();
    const projectId = getActiveProject()?.id;
    const [runner, engine] = await Promise.all([
      invoke<{ agentPath: string; runnerPath: string; name: string; args: string[] }>(
        "resolve_agent_runner",
      ),
      selectedEngine(),
    ]);
    const shellEnv = engine?.env ?? agentShellEnv(await invoke<AgentEnvInfo>("get_agent_env"));
    if (getActiveProject()?.id !== projectId) {
      throw new Error(
        "Project changed before the Cairngorm agent could start. Start it again in the intended project.",
      );
    }

    // Generate session ID before openTab so we can pass it to the agent
    const agentSessionId = `term-agent-${Date.now()}`;

    // Check the agent, not the runner: bun.exe/node.exe still need the script.
    const isBinary = !/\.(js|ts)$/i.test(runner.agentPath);
    let shellArgs: string[];
    if (isBinary) {
      shellArgs = ["--sidecar", "--session-id", agentSessionId];
    } else {
      shellArgs = [...runner.args, runner.agentPath, "--sidecar", "--session-id", agentSessionId];
    }

    if (engine) {
      shellArgs.push(engine.flag);
    }
    debugLog(
      "terminal-tabs",
      "spawn-agent",
      `shell=${runner.runnerPath} args=${shellArgs.join(",")} isBinary=${isBinary} sid=${agentSessionId}`,
    );
    openTab({
      profile: "code-assistant",
      shellPath: runner.runnerPath,
      shellArgs: shellArgs,
      shellEnv: shellEnv,
      isAgent: true,
      sessionId: agentSessionId,
    });
  }, [openTab]);

  // Cairngorm agent only on explicit request. Its setup never blocks shells/files.
  const newAgent = useCallback(() => {
    if (agentStarting.current) {
      return;
    }
    agentStarting.current = true;
    setInitStatus("loading");
    setInitError("");
    spawnAgent()
      .then(() => {
        setInitStatus("ready");
        setInitError("");
      })
      .catch((err) => {
        setInitStatus("error");
        setInitError(errorMessage(err));
      })
      .finally(() => {
        agentStarting.current = false;
      });
  }, [spawnAgent]);

  const dismissAgentProblem = () => {
    setInitStatus("ready");
    setInitError("");
  };
  return { initStatus, initError, newAgent, dismissAgentProblem };
}
