import { describe, test, expect } from "bun:test";
import { Agent } from "../agent/agent.js";
import { allTools } from "../tools/index.js";
import type { AgentEvent } from "../agent/types.js";
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

function assistantStream(
  assistant: AssistantMessage,
): (
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream {
  return () => {
    const stream = createAssistantMessageEventStream();
    const textBlocks = assistant.content
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.type === "text");
    const toolBlocks = assistant.content
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.type === "toolCall");
    stream.push({ type: "start", partial: assistant });
    for (const { c, i } of textBlocks) {
      stream.push({
        type: "text_delta",
        contentIndex: i,
        delta: (c as any).text ?? "",
        partial: assistant,
      });
    }
    for (const { c, i } of toolBlocks) {
      stream.push({ type: "toolcall_start", contentIndex: i, partial: assistant });
      stream.push({
        type: "toolcall_end",
        contentIndex: i,
        toolCall: c as any,
        partial: assistant,
      });
    }
    stream.push({
      type: "done",
      reason: assistant.stopReason === "toolUse" ? "toolUse" : "stop",
      message: assistant,
    });
    stream.end();
    return stream;
  };
}

function toolThenText(
  calls: { id: string; name: string; arguments: Record<string, unknown> }[],
): (
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream {
  let turn = 0;
  return (model: Model<any>, context: Context, options?: SimpleStreamOptions) => {
    if (turn === 0) {
      turn++;
      return assistantStream(
        baseAssistant(
          calls.map((c) => ({ type: "toolCall" as const, ...c })),
          "toolUse",
        ),
      )(model, context, options);
    }
    return textStream("done")(model, context, options);
  };
}

function singleToolStream(
  calls: { id: string; name: string; arguments: Record<string, unknown> }[],
): (
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream {
  return assistantStream(
    baseAssistant(
      calls.map((c) => ({ type: "toolCall" as const, ...c })),
      "toolUse",
    ),
  );
}

describe("Agent loop event sequence", () => {
  test("text response emits agent_start -> turn_start -> context_transformed -> message_* -> turn_end -> agent_end", async () => {
    const agent = new Agent({
      sessionId: "seq-1",
      streamFn: textStream("hello"),
      initialState: { model: FAKE_MODEL, tools: allTools() },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((e) => {
      events.push(e);
    });
    await agent.prompt("hi");

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("agent_start");
    expect(types[types.length - 1]).toBe("agent_end");

    const startIdx = types.indexOf("agent_start");
    const turnStartIdx = types.indexOf("turn_start");
    const ctxIdx = types.indexOf("context_transformed");
    const turnEndIdx = types.indexOf("turn_end");
    const agentEndIdx = types.indexOf("agent_end");

    expect(startIdx).toBe(0);
    expect(turnStartIdx).toBeGreaterThan(startIdx);
    expect(ctxIdx).toBeGreaterThan(turnStartIdx);
    expect(turnEndIdx).toBeGreaterThan(ctxIdx);
    expect(agentEndIdx).toBeGreaterThan(turnEndIdx);

    // Assistant message_start/end occur after context_transformed
    const assistantStarts = events
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e, i }) =>
          i > ctxIdx && e.type === "message_start" && (e as any).message.role === "assistant",
      )
      .map(({ i }) => i);
    const assistantEnds = events
      .map((e, i) => ({ e, i }))
      .filter(
        ({ e, i }) =>
          i > ctxIdx && e.type === "message_end" && (e as any).message.role === "assistant",
      )
      .map(({ i }) => i);
    expect(assistantStarts.length).toBeGreaterThan(0);
    expect(assistantEnds.length).toBeGreaterThan(0);

    const startEvent = events[startIdx] as Extract<AgentEvent, { type: "agent_start" }>;
    expect(startEvent.sessionId).toBe("seq-1");
  });

  test("tool_execution_start and tool_execution_end are paired with identical toolCallId", async () => {
    const agent = new Agent({
      sessionId: "pair-1",
      streamFn: toolThenText([{ id: "tc-1", name: "bash", arguments: { command: "echo paired" } }]),
      initialState: { model: FAKE_MODEL, tools: allTools() },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((e) => {
      events.push(e);
    });
    await agent.prompt("run tool");

    const starts = events.filter((e) => e.type === "tool_execution_start") as Extract<
      AgentEvent,
      { type: "tool_execution_start" }
    >[];
    const ends = events.filter((e) => e.type === "tool_execution_end") as Extract<
      AgentEvent,
      { type: "tool_execution_end" }
    >[];

    expect(starts.length).toBe(ends.length);
    expect(starts.length).toBe(1);
    expect(ends[0].toolCallId).toBe(starts[0].toolCallId);
  });

  test("terminate hint skips a follow-up assistant message", async () => {
    const agent = new Agent({
      sessionId: "term-1",
      streamFn: singleToolStream([
        { id: "tc-1", name: "bash", arguments: { command: "echo done" } },
      ]),
      initialState: { model: FAKE_MODEL, tools: allTools() },
    });
    const events: AgentEvent[] = [];
    agent.subscribe((e) => {
      events.push(e);
    });

    // Force the bash tool to return terminate:true for this run
    const tools = agent.state.tools;
    const bash = tools.find((t) => t.name === "bash")!;
    const originalExecute = bash.execute;
    bash.execute = async (...args: any[]) => {
      const result = await (originalExecute as any)(...args);
      return { ...result, terminate: true };
    };

    await agent.prompt("terminate");

    const assistantMsgStarts = events.filter(
      (e) => e.type === "message_start" && (e as any).message.role === "assistant",
    ).length;
    const toolEndIdx = events.findIndex((e) => e.type === "tool_execution_end");
    const turnEndIdx = events.findIndex((e) => e.type === "turn_end");
    const nextAssistantAfterTool = events.findIndex(
      (e, i) =>
        i > toolEndIdx &&
        i < turnEndIdx &&
        e.type === "message_start" &&
        (e as any).message.role === "assistant",
    );

    expect(assistantMsgStarts).toBe(1); // only the tool-requesting assistant message
    expect(nextAssistantAfterTool).toBe(-1);
  });

  test("parallel mode emits all tool_execution_start before any tool_execution_end", async () => {
    const agent = new Agent({
      sessionId: "par-1",
      streamFn: toolThenText([
        {
          id: "tc-a",
          name: "bash",
          arguments: { command: process.platform === "win32" ? "echo a" : "echo a" },
        },
        {
          id: "tc-b",
          name: "bash",
          arguments: { command: process.platform === "win32" ? "echo b" : "echo b" },
        },
      ]),
      initialState: { model: FAKE_MODEL, tools: allTools() },
      toolExecution: "parallel",
    });
    const events: AgentEvent[] = [];
    agent.subscribe((e) => {
      events.push(e);
    });
    await agent.prompt("parallel");

    const indices = events.map((e, i) => ({ e, i }));
    const starts = indices.filter(({ e }) => e.type === "tool_execution_start").map(({ i }) => i);
    const ends = indices.filter(({ e }) => e.type === "tool_execution_end").map(({ i }) => i);

    expect(starts.length).toBe(2);
    expect(ends.length).toBe(2);
    expect(Math.max(...starts)).toBeLessThan(Math.min(...ends));
  });

  test("sequential mode emits start-end pairs in order", async () => {
    const agent = new Agent({
      sessionId: "seq-2",
      streamFn: toolThenText([
        { id: "tc-a", name: "bash", arguments: { command: "echo a" } },
        { id: "tc-b", name: "bash", arguments: { command: "echo b" } },
      ]),
      initialState: { model: FAKE_MODEL, tools: allTools() },
      toolExecution: "sequential",
    });
    const events: AgentEvent[] = [];
    agent.subscribe((e) => {
      events.push(e);
    });
    await agent.prompt("sequential");

    const types = events.map((e) => e.type);
    const firstEnd = types.indexOf("tool_execution_end");
    const secondStart = types.indexOf("tool_execution_start", firstEnd);

    expect(firstEnd).toBeGreaterThan(-1);
    expect(secondStart).toBeGreaterThan(firstEnd);
  });
});
