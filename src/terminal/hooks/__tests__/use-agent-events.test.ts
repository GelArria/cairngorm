import { act, renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useAgentEvents } from "../use-agent-events";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, handler: (e: { payload: any }) => void) => {
    (globalThis as any).__agentEventListen = handler;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("@tauri-apps/api/core", () => {
  const invokeFn = vi.fn(() => Promise.resolve());
  (globalThis as any).__agentInvoke = invokeFn;
  return { invoke: invokeFn };
});

const getListener = () => (globalThis as any).__agentEventListen as (e: { payload: any }) => void;
const getInvoke = () => (globalThis as any).__agentInvoke as ReturnType<typeof vi.fn>;

describe("useAgentEvents", () => {
  beforeEach(() => {
    getInvoke().mockClear();
    (globalThis as any).__agentEventListen = undefined;
  });

  test("accumulates agent-event payloads for a session", async () => {
    const { result } = renderHook(() => useAgentEvents());

    await waitFor(() => expect(typeof getListener()).toBe("function"));

    act(() => {
      getListener()({ payload: { type: "agent_start", session_id: "s1" } });
      getListener()({
        payload: {
          type: "message_update",
          session_id: "s1",
          assistantMessageEvent: { type: "text_delta", delta: "hi" },
        },
      });
    });

    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.getEvents("s1")).toHaveLength(2);
    expect(result.current.getEvents("s2")).toHaveLength(0);
  });

  test("tracks session lifecycle status", async () => {
    const { result } = renderHook(() => useAgentEvents());

    await waitFor(() => expect(typeof getListener()).toBe("function"));

    act(() => {
      getListener()({ payload: { type: "agent_start", session_id: "s1" } });
    });
    await waitFor(() => expect(result.current.getStatus("s1")).toBe("running"));

    act(() => {
      getListener()({ payload: { type: "agent_end", session_id: "s1" } });
    });
    await waitFor(() => expect(result.current.getStatus("s1")).toBe("ended"));
  });

  test("steer invokes agent_steer command", async () => {
    const { result } = renderHook(() => useAgentEvents());

    await act(async () => {
      await result.current.steer("s1", "stop now");
    });

    expect(getInvoke()).toHaveBeenCalledWith("agent_steer", {
      sessionId: "s1",
      instruction: "stop now",
      mode: undefined,
    });
  });

  test("sendPrompt writes JSONL prompt to PTY stdin", async () => {
    const { result } = renderHook(() => useAgentEvents());

    await act(async () => {
      await result.current.sendPrompt("s1", "hello");
    });

    expect(getInvoke()).toHaveBeenCalledWith("pty_write", {
      sessionId: "s1",
      data: '{"type":"prompt","content":"hello"}\n',
    });
  });

  test("ignores empty steer instructions", async () => {
    const { result } = renderHook(() => useAgentEvents());

    await act(async () => {
      await result.current.steer("s1", "   ");
    });

    expect(getInvoke()).not.toHaveBeenCalled();
  });
});
