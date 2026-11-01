import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  agentEnvironment,
  restoreWorkspaceProcesses,
} from "../../src/terminal/data/session-launch";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => vi.mocked(invoke).mockReset());

it("restores Codex engines from live runtime configuration, never an API credential", async () => {
  const env = {
    CAIRNGORM_CODEX_COMMAND: '{"program":"codex.exe","args":[]}',
    CODEX_HOME: "C:/accounts/codex",
  };
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "get_codex_agent_env" ? env : cmd === "detect_home" ? "C:/home" : undefined,
  );
  expect(await agentEnvironment(["--sidecar", "--codex"])).toEqual(env);
  await restoreWorkspaceProcesses([
    {
      id: "1",
      title: "Agent",
      profile: "code-assistant",
      status: "running",
      sessionId: "s1",
      detached: false,
      isAgent: true,
      shellPath: "cairngorm-agent.exe",
      shellArgs: ["--sidecar", "--codex"],
      cwd: "C:/project",
    },
  ]);
  expect(invoke).toHaveBeenCalledWith(
    "pty_ensure",
    expect.objectContaining({ cwd: "C:/project", parseJsonl: true, env: Object.entries(env) }),
  );
  expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "get_agent_env")).toBe(false);
});

it("does not silently restore a Codex agent with an API engine after deselection", async () => {
  vi.mocked(invoke).mockResolvedValue(null);
  await expect(agentEnvironment(["--codex"])).rejects.toThrow("no longer selected");
});
