import { act, cleanup, renderHook } from "@testing-library/preact";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useAgentEvents } from "../../src/terminal/hooks/use-agent-events";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
beforeEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});
it("Chat UI recreates a restored Codex sidecar with a live account environment and project cwd", async () => {
  const env = {
    CAIRNGORM_CODEX_COMMAND: '{"program":"codex.exe","args":[]}',
    CODEX_HOME: "C:/account",
  };
  vi.mocked(invoke).mockImplementation(async (cmd) =>
    cmd === "get_codex_agent_env" ? env : undefined,
  );
  const { result } = renderHook(() => useAgentEvents());
  await act(async () =>
    result.current.sendPrompt("s1", "hello", {
      shell: "agent.exe",
      args: ["--sidecar", "--codex"],
      cwd: "C:/project",
    }),
  );
  expect(invoke).toHaveBeenCalledWith(
    "pty_ensure",
    expect.objectContaining({ cwd: "C:/project", env: Object.entries(env), parseJsonl: true }),
  );
  expect(invoke).toHaveBeenCalledWith("pty_write", {
    sessionId: "s1",
    data: '{"type":"prompt","content":"hello"}\n',
  });
});
