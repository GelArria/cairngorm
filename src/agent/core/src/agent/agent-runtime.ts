import { errorMessage } from "../ai/utils/error-message.js";
import { EMPTY_USAGE, type MutableAgentState } from "./agent-state.js";
import type { AgentEvent, AgentMessage } from "./types.js";
type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};

/** Own run settlement and ordered listener delivery independently of prompt queues. */
export class AgentRuntime {
  private activeRun?: ActiveRun;
  private readonly listeners = new Set<
    (event: AgentEvent, signal: AbortSignal) => Promise<void> | void
  >();
  constructor(private readonly state: MutableAgentState) {}
  get isActive(): boolean {
    return !!this.activeRun;
  }
  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  abort(): void {
    this.activeRun?.abortController.abort();
  }
  waitForIdle(): Promise<void> {
    return this.activeRun?.promise ?? Promise.resolve();
  }
  async run(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.activeRun) {
      throw new Error("Agent is already processing.");
    }

    const abortController = new AbortController();
    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    this.activeRun = { promise, resolve: resolvePromise, abortController };

    this.state.isStreaming = true;
    this.state.streamingMessage = undefined;
    this.state.errorMessage = undefined;

    try {
      await executor(abortController.signal);
    } catch (error) {
      await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
      this.finishRun();
    }
  }

  private async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    const failureMessage = {
      role: "assistant",
      content: [{ type: "text", text: "" }],
      api: this.state.model.api,
      provider: this.state.model.provider,
      model: this.state.model.id,
      usage: EMPTY_USAGE,
      stopReason: aborted ? "aborted" : "error",
      errorMessage: errorMessage(error),
      timestamp: Date.now(),
    } satisfies AgentMessage;
    await this.emit({ type: "message_start", message: failureMessage });
    await this.emit({ type: "message_end", message: failureMessage });
    await this.emit({ type: "turn_end", message: failureMessage, toolResults: [] });
    await this.emit({ type: "agent_end", messages: [failureMessage] });
  }

  private finishRun(): void {
    this.state.isStreaming = false;
    this.state.streamingMessage = undefined;
    this.state.pendingToolCalls = new Set<string>();
    this.activeRun?.resolve();
    this.activeRun = undefined;
  }

  async emit(event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "message_start":
        this.state.streamingMessage = event.message;
        break;

      case "message_update":
        this.state.streamingMessage = event.message;
        break;

      case "message_end":
        this.state.streamingMessage = undefined;
        this.state.messages.push(event.message);
        break;

      case "tool_execution_start": {
        const pendingToolCalls = new Set(this.state.pendingToolCalls);
        pendingToolCalls.add(event.toolCallId);
        this.state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case "tool_execution_end": {
        const pendingToolCalls = new Set(this.state.pendingToolCalls);
        pendingToolCalls.delete(event.toolCallId);
        this.state.pendingToolCalls = pendingToolCalls;
        break;
      }

      case "turn_end":
        if (event.message.role === "assistant" && event.message.errorMessage) {
          this.state.errorMessage = event.message.errorMessage;
        }
        break;

      case "agent_end":
        this.state.streamingMessage = undefined;
        break;
    }

    const signal = this.activeRun?.abortController.signal;
    if (!signal) {
      throw new Error("Agent listener invoked outside active run");
    }
    for (const listener of this.listeners) {
      await listener(event, signal);
    }
  }
}
