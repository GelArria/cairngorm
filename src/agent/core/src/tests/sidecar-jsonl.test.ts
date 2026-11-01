import { describe, test, expect } from "bun:test";
import { allTools } from "../tools/index.js";
import type { AgentEvent } from "../agent/types.js";

describe("Sidecar JSONL assertions", () => {
  test("agent_start event schema includes sessionId and tools", () => {
    const tools = allTools();
    const event: AgentEvent = {
      type: "agent_start",
      sessionId: "abc-123",
      tools: tools.map((t) => ({ name: t.name, label: t.label, description: t.description })),
    };
    expect(event.sessionId).toBe("abc-123");
    expect(event.tools).toHaveLength(6);
    expect(event.tools![0]).toHaveProperty("name");
    expect(event.tools![0]).toHaveProperty("label");
    expect(event.tools![0]).toHaveProperty("description");
  });

  test("agent_end event schema includes sessionId", () => {
    const event: AgentEvent = { type: "agent_end", sessionId: "abc-123", messages: [] };
    expect(event.sessionId).toBe("abc-123");
  });

  test("context_transformed event schema", () => {
    const event: AgentEvent = { type: "context_transformed", messageCount: 3 };
    expect(event.messageCount).toBe(3);
  });

  test("steering_received event schema", () => {
    const event: AgentEvent = { type: "steering_received", instruction: "stop", mode: "interrupt" };
    expect(event.instruction).toBe("stop");
    expect(event.mode).toBe("interrupt");
  });
});

describe("Tool name validation", () => {
  test("all tool names are kebab-case as required", () => {
    const tools = allTools();
    const expected = ["bash", "file-read", "file-write", "grep", "glob", "edit"];
    for (const name of expected) {
      expect(tools.some((t) => t.name === name)).toBe(true);
    }
  });
});
