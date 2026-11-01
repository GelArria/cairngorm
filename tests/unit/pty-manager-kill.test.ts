import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachPty } from "../../src/terminal/data/pty-manager";

// Mock @tauri-apps/api/core and @tauri-apps/api/event
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { invoke } from "@tauri-apps/api/core";

describe("attachPty killOnAgentEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes killOnAgentEnd: false when isAgent is true", async () => {
    await attachPty(
      {
        sessionId: "sess-agent",
        shellPath: "C:\\Windows\\System32\\cmd.exe",
        shellArgs: [],
        shellEnv: {},
        cwd: "C:\\",
        isAgent: true,
      }, // isAgent = true
    );

    const calls = vi.mocked(invoke).mock.calls;
    const ensureCall = calls.find((c) => c[0] === "pty_ensure");
    expect(ensureCall).toBeDefined();
    const args = ensureCall![1] as Record<string, unknown>;
    expect(args.killOnAgentEnd).toBe(false);
  });

  it("passes killOnAgentEnd: false when isAgent is false", async () => {
    await attachPty(
      {
        sessionId: "sess-user",
        shellPath: "C:\\Windows\\System32\\cmd.exe",
        shellArgs: [],
        shellEnv: {},
        cwd: "C:\\",
        isAgent: false,
      }, // isAgent = false
    );

    const calls = vi.mocked(invoke).mock.calls;
    const ensureCall = calls.find((c) => c[0] === "pty_ensure");
    expect(ensureCall).toBeDefined();
    const args = ensureCall![1] as Record<string, unknown>;
    expect(args.killOnAgentEnd).toBe(false);
  });

  it("passes killOnAgentEnd: false regardless of isAgent value", async () => {
    for (const isAgent of [true, false]) {
      vi.clearAllMocks();
      await attachPty({
        sessionId: `sess-${isAgent}`,
        shellPath: "bash",
        shellArgs: ["-l"],
        shellEnv: { FOO: "bar" },
        cwd: "/home/user",
        isAgent: isAgent,
      });

      const ensureCall = vi.mocked(invoke).mock.calls.find((c) => c[0] === "pty_ensure");
      expect(ensureCall).toBeDefined();
      const args = ensureCall![1] as Record<string, unknown>;
      expect(args.killOnAgentEnd).toBe(false);
      expect(args.sessionId).toBe(`sess-${isAgent}`);
      expect(args.shell).toBe("bash");
      expect(args.args).toEqual(["-l"]);
      expect(args.env).toEqual([["FOO", "bar"]]);
      expect(args.cwd).toBe("/home/user");
      expect(args.parseJsonl).toBe(isAgent);
    }
  });

  it("does not pass killOnAgentEnd: true for any call", async () => {
    await attachPty({
      sessionId: "sess-any",
      shellPath: "sh",
      shellArgs: [],
      shellEnv: {},
      cwd: "/",
      isAgent: true,
    });

    const calls = vi.mocked(invoke).mock.calls;
    for (const call of calls) {
      const args = call[1] as Record<string, unknown> | undefined;
      if (args && "killOnAgentEnd" in args) {
        expect(args.killOnAgentEnd).not.toBe(true);
      }
    }
  });
});
