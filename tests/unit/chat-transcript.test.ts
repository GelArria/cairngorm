import { describe, it, expect } from "vitest";
import { buildChatMessages, type ChatEntry } from "../../src/terminal/model/chat-transcript";
import type { AgentEvent, ChatMessage } from "../../src/terminal/shared/agent-events";

let n = 0;
const sid = "s1";
const base = () => ({ session_id: sid, timestamp: 1000 });

function userEvent(text: string, ts: number): AgentEvent {
  return {
    ...base(),
    type: "message_start",
    timestamp: ts,
    message: { role: "user", content: [{ type: "text", text }], timestamp: ts },
  };
}

function delta(t: string): AgentEvent {
  return {
    session_id: sid,
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: t },
  };
}

function toolStart(name: string, callId: string, args: unknown = { query: "Home" }): AgentEvent {
  return {
    session_id: sid,
    type: "tool_execution_start",
    toolCallId: callId,
    toolName: name,
    args,
    timestamp: 2000,
  };
}

function toolEnd(callId: string, result: unknown, isError = false): AgentEvent {
  return {
    session_id: sid,
    type: "tool_execution_end",
    toolCallId: callId,
    toolName: "x",
    result,
    isError,
    timestamp: 3000,
  };
}

describe("buildChatMessages", () => {
  const t = (over: Partial<ChatMessage>): ChatMessage => ({
    id: "x",
    role: "assistant",
    content: "",
    timestamp: 0,
    ...over,
  });

  it("builds a user block from message_start", () => {
    const msgs = buildChatMessages([userEvent("fix the sidebar", 1000)]);
    expect(msgs).toEqual([
      t({ id: "m0", role: "user", content: "fix the sidebar", timestamp: 1000 }),
    ]);
  });

  it("renders assistant reply text (non-empty branch)", () => {
    const events: AgentEvent[] = [
      userEvent("hi", 1000),
      {
        session_id: sid,
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "ok" },
      },
    ];
    const msgs = buildChatMessages(events);
    expect(msgs.some((m) => m.role === "assistant" && m.content === "ok")).toBe(true);
  });

  it("streams text_delta into an assistant block and closes it at tool_execution_start", () => {
    const events: AgentEvent[] = [
      userEvent("search Home", 1000),
      {
        session_id: sid,
        type: "message_start",
        timestamp: 1100,
        message: { role: "assistant", content: [], timestamp: 1100 },
      },
      delta("Looking "),
      delta("for Home…"),
      toolStart("grep", "c1"),
    ];
    const msgs = buildChatMessages(events);
    expect(msgs).toEqual([
      t({ id: "m0", role: "user", content: "search Home", timestamp: 1000 }),
      t({ id: "m1", role: "assistant", content: "Looking for Home…", timestamp: 2000 }),
      t({
        id: "m2",
        role: "tool",
        content: "",
        toolName: "grep",
        toolArg: "Home",
        toolCallId: "c1",
        toolStatus: "running",
        timestamp: 2000,
      }),
    ]);
  });

  it("matches tool execution end by toolCallId (concurrent-safe)", () => {
    const events: AgentEvent[] = [
      toolStart("grep", "c1"),
      toolStart("grep", "c2"),
      toolEnd("c2", "two"),
      toolEnd("c1", "one"),
    ];
    const msgs = buildChatMessages(events);
    const byId = new Map(msgs.filter((m) => m.role === "tool").map((m) => [m.toolCallId, m]));
    expect(byId.get("c1")!.toolStatus).toBe("ended");
    expect(byId.get("c2")!.content).toBe("two");
    expect(byId.get("c1")!.content).toBe("one");
  });

  it("reports agent error as an error block", () => {
    const events: AgentEvent[] = [
      {
        session_id: sid,
        type: "message_start",
        timestamp: 1100,
        message: { role: "assistant", content: [], timestamp: 1100 },
      },
      {
        session_id: sid,
        type: "message_end",
        timestamp: 1200,
        message: {
          role: "assistant",
          content: [],
          timestamp: 1200,
          stopReason: "error",
          errorMessage: "rate limit",
        },
      },
    ];
    const msgs = buildChatMessages(events);
    expect(msgs).toEqual([
      t({
        id: "m0",
        role: "system",
        content: "agent error: rate limit",
        timestamp: 1200,
        isError: true,
      }),
    ]);
  });
});

it("tolerates a text_delta event without delta (no crash, no phantom block)", () => {
  const events: AgentEvent[] = [
    {
      session_id: sid,
      type: "message_update",
      // Wire-slimmed message_update: assistantMessageEvent may arrive with no
      // delta field (see cli.ts serializeSidecarEvent) — must not crash or
      // render an empty assistant block.
      assistantMessageEvent: { type: "text_delta" },
    },
  ];
  expect(buildChatMessages(events)).toEqual([]);
});
