import { describe, test, expect } from "bun:test";
import { runSidecar } from "../tui/sidecar.js";
import type { Agent } from "../agent/agent.js";
import { Readable } from "node:stream";

// Minimal mock Agent that records prompt() and steer() calls
function createMockAgent(): Agent & {
  prompts: string[];
  steers: Array<{ instruction: string; mode?: string }>;
  stdouts: string[];
} {
  const prompts: string[] = [];
  const steers: Array<{ instruction: string; mode?: string }> = [];
  const stdouts: string[] = [];

  const agent = {
    prompts,
    steers,
    stdouts,
    prompt(content: string) {
      prompts.push(content);
      return Promise.resolve();
    },
    steer(message: any, options?: { mode?: string }) {
      steers.push({ instruction: message.content ?? "", mode: options?.mode });
    },
    // Satisfy Agent interface stubs
    subscribe() {
      return () => {};
    },
    get state() {
      return {} as any;
    },
    set steeringMode(_: any) {},
    get steeringMode() {
      return "one-at-a-time" as any;
    },
    set followUpMode(_: any) {},
    get followUpMode() {
      return "one-at-a-time" as any;
    },
    followUp() {},
    clearSteeringQueue() {},
    clearFollowUpQueue() {},
    clearAllQueues() {},
    hasQueuedMessages() {
      return false;
    },
    get signal() {
      return undefined;
    },
    abort() {},
    waitForIdle() {
      return Promise.resolve();
    },
    reset() {},
    continue() {
      return Promise.resolve();
    },
    sessionId: undefined,
    convertToLlm: async (m: any) => m,
    transformContext: async (m: any) => m,
    streamFn: undefined as any,
    getApiKey: undefined,
    onPayload: undefined,
    onResponse: undefined,
    beforeToolCall: undefined,
    afterToolCall: undefined,
    prepareNextTurn: undefined,
    thinkingBudgets: undefined,
    transport: "auto" as any,
    maxRetryDelayMs: undefined,
    toolExecution: "parallel" as any,
  } as any;

  return agent;
}

describe("runSidecar plain text fallback", () => {
  test("accepts plain text input and calls agent.prompt", async () => {
    const agent = createMockAgent();
    const input = Readable.from(["hello world\n"]);
    await runSidecar(agent as unknown as Agent, "sess-1", input);

    expect(agent.prompts).toHaveLength(1);
    expect(agent.prompts[0]).toBe("hello world");
  });

  test("accepts JSON prompt and calls agent.prompt", async () => {
    const agent = createMockAgent();
    const input = Readable.from([JSON.stringify({ type: "prompt", content: "hello" }) + "\n"]);
    await runSidecar(agent as unknown as Agent, "sess-2", input);

    expect(agent.prompts).toHaveLength(1);
    expect(agent.prompts[0]).toBe("hello");
  });

  test("malformed JSON writes error to stderr and does not crash", async () => {
    const agent = createMockAgent();
    const input = Readable.from(['{"broken"\n']);

    const stderrLines: string[] = [];
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => {
      stderrLines.push(String(chunk));
      return true;
    }) as any;

    try {
      await runSidecar(agent as unknown as Agent, "sess-3", input);
    } finally {
      process.stderr.write = origStderrWrite;
    }

    expect(agent.prompts).toHaveLength(0);
    expect(stderrLines.length).toBeGreaterThan(0);
    expect(stderrLines[0]).toContain("Invalid JSON");
  });

  test("empty lines are skipped", async () => {
    const agent = createMockAgent();
    const input = Readable.from([
      "\n",
      "   \n",
      JSON.stringify({ type: "prompt", content: "real" }) + "\n",
      "\n",
    ]);
    await runSidecar(agent as unknown as Agent, "sess-4", input);

    expect(agent.prompts).toHaveLength(1);
    expect(agent.prompts[0]).toBe("real");
  });

  test("steer command calls agent.steer and writes ack to stdout", async () => {
    const agent = createMockAgent();
    const input = Readable.from([
      JSON.stringify({ type: "steer", instruction: "stop", mode: "interrupt" }) + "\n",
    ]);

    const stdoutLines: string[] = [];
    const origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      stdoutLines.push(String(chunk));
      return true;
    }) as any;

    try {
      await runSidecar(agent as unknown as Agent, "sess-5", input);
    } finally {
      process.stdout.write = origStdoutWrite;
    }

    expect(agent.steers).toHaveLength(1);
    expect(agent.steers[0].instruction).toBe("stop");
    expect(agent.steers[0].mode).toBe("interrupt");
    expect(stdoutLines.length).toBeGreaterThan(0);
    expect(stdoutLines[0]).toContain("steering_received");
    expect(stdoutLines[0]).toContain("sess-5");
  });
});
