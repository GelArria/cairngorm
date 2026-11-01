import { describe, test, expect } from "bun:test";
import { Agent } from "../agent/agent.js";
import { allTools } from "../tools/index.js";
import type { AgentEvent, AgentTool } from "../agent/types.js";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "../ai/types.js";
import { createAssistantMessageEventStream } from "../ai/utils/event-stream.js";
import type { AssistantMessageEventStream } from "../ai/utils/event-stream.js";

const FAKE_MODEL: Model<any> = {
  id: "fake",
  name: "Fake",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

function baseAssistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "openai",
    model: "fake",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function textStream(
  answer: string,
): (
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream {
  return () => {
    const stream = createAssistantMessageEventStream();
    const assistant = baseAssistant([{ type: "text", text: answer }]);
    stream.push({ type: "start", partial: assistant });
    stream.push({ type: "text_delta", contentIndex: 0, delta: answer, partial: assistant });
    stream.push({ type: "done", reason: "stop", message: assistant });
    stream.end();
    return stream;
  };
}

// Replicates serializeSidecarEvent from cli.ts for indirect testing
function serializeSidecarEvent(event: AgentEvent, sid: string): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...event, session_id: sid };
  delete (payload as Record<string, unknown>).sessionId;
  if (event.type === "agent_start" && event.tools) {
    payload.tools = event.tools.map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
    }));
  }
  return payload;
}

// Replicates arg parsing logic from cli.ts
function parseSessionId(args: string[]): string | undefined {
  return args.find((a, i) => args[i - 1] === "--session-id");
}

function generateSessionId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe("serializeSidecarEvent", () => {
  test("agent_start contains session_id, tools array with name/label/description", () => {
    const tools = allTools();
    const event: AgentEvent = {
      type: "agent_start",
      sessionId: "sess-abc",
      tools: tools.map((t) => ({ name: t.name, label: t.label, description: t.description })),
    };
    const payload = serializeSidecarEvent(event, "sess-abc");

    expect(payload.session_id).toBe("sess-abc");
    expect(payload.sessionId).toBeUndefined();
    expect(payload.type).toBe("agent_start");
    expect(Array.isArray(payload.tools)).toBe(true);
    const mapped = payload.tools as { name: string; label: string; description: string }[];
    expect(mapped.length).toBe(tools.length);
    for (const t of mapped) {
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("label");
      expect(t).toHaveProperty("description");
    }
  });

  test("message_start contains full message payload with content text", () => {
    const msg: AgentEvent = {
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() },
    };
    const payload = serializeSidecarEvent(msg, "sess-xyz");

    expect(payload.session_id).toBe("sess-xyz");
    expect(payload.type).toBe("message_start");
    expect(payload.message).toBeDefined();
    const message = payload.message as { content: Array<{ type: string; text: string }> };
    expect(message.content[0].type).toBe("text");
    expect(message.content[0].text).toBe("hello");
  });

  test("tool_execution_start contains toolCallId, toolName, args", () => {
    const event: AgentEvent = {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "echo hi" },
    };
    const payload = serializeSidecarEvent(event, "sess-tc");

    expect(payload.session_id).toBe("sess-tc");
    expect(payload.type).toBe("tool_execution_start");
    expect(payload.toolCallId).toBe("tc-1");
    expect(payload.toolName).toBe("bash");
    expect(payload.args).toEqual({ command: "echo hi" });
  });

  test("tool_execution_end contains toolCallId, toolName, result, isError", () => {
    const event: AgentEvent = {
      type: "tool_execution_end",
      toolCallId: "tc-2",
      toolName: "file-read",
      result: { content: [{ type: "text", text: "data" }], details: {} },
      isError: false,
    };
    const payload = serializeSidecarEvent(event, "sess-end");

    expect(payload.session_id).toBe("sess-end");
    expect(payload.type).toBe("tool_execution_end");
    expect(payload.toolCallId).toBe("tc-2");
    expect(payload.toolName).toBe("file-read");
    expect(payload.result).toEqual({ content: [{ type: "text", text: "data" }], details: {} });
    expect(payload.isError).toBe(false);
  });

  test("agent_end contains session_id and messages", () => {
    const event: AgentEvent = { type: "agent_end", sessionId: "sess-end", messages: [] };
    const payload = serializeSidecarEvent(event, "sess-end");

    expect(payload.session_id).toBe("sess-end");
    expect(payload.sessionId).toBeUndefined();
    expect(payload.messages).toEqual([]);
  });

  test("event without sessionId still gets session_id added", () => {
    const event: AgentEvent = { type: "turn_start" };
    const payload = serializeSidecarEvent(event, "sess-turn");

    expect(payload.session_id).toBe("sess-turn");
    expect(payload.type).toBe("turn_start");
  });

  test("malformed tools prop throws TypeError", () => {
    // Negative: tools not array must crash as expected by strict schema
    const event = {
      type: "agent_start" as const,
      sessionId: "s",
      tools: "bad" as unknown as AgentTool[],
    };
    expect(() => serializeSidecarEvent(event, "s")).toThrow("event.tools.map is not a function");
  });
});

describe("--session-id arg parsing", () => {
  test("parses --session-id from args", () => {
    const args = ["--sidecar", "--session-id", "my-session-123"];
    const sid = parseSessionId(args);
    expect(sid).toBe("my-session-123");
  });

  test("returns undefined when --session-id not present", () => {
    const args = ["--sidecar", "--profile", "default"];
    const sid = parseSessionId(args);
    expect(sid).toBeUndefined();
  });

  test("returns undefined when flag is last element", () => {
    const args = ["--sidecar", "--session-id"];
    const sid = parseSessionId(args);
    expect(sid).toBeUndefined();
  });
});

describe("generateSessionId", () => {
  test("produces valid UUID format when crypto.randomUUID available", () => {
    const sid = generateSessionId();
    expect(sid).toBeTruthy();
    expect(sid.length).toBeGreaterThan(10);
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test(sid)).toBe(true);
  });

  test("produces non-empty fallback when randomUUID missing", () => {
    // Temporarily mask randomUUID to hit fallback path
    const orig = (crypto as any).randomUUID;
    (crypto as any).randomUUID = undefined;
    try {
      const sid = generateSessionId();
      expect(sid).toBeTruthy();
      expect(sid.includes("-")).toBe(true);
    } finally {
      (crypto as any).randomUUID = orig;
    }
  });
});

describe("Agent subscriber JSONL output", () => {
  test("subscriber emits JSONL with session_id for each event", async () => {
    const agent = new Agent({
      sessionId: "sub-sess",
      streamFn: textStream("ok"),
      initialState: { model: FAKE_MODEL, tools: allTools() },
    });
    const lines: string[] = [];
    agent.subscribe((event) => {
      const payload = serializeSidecarEvent(event, "sub-sess");
      lines.push(JSON.stringify(payload));
    });
    await agent.prompt("hi");

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.session_id).toBe("sub-sess");
    }
  });
});
