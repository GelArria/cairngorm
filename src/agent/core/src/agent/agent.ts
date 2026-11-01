import { streamSimple } from "../ai/stream.js";
import type {
  ImageContent,
  Message,
  SimpleStreamOptions,
  TextContent,
  ThinkingBudgets,
  Transport,
} from "../ai/types.js";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import { type AgentOptions } from "./agent-options.js";
import { AgentRuntime } from "./agent-runtime.js";
import {
  type MutableAgentState,
  createMutableAgentState,
  defaultConvertToLlm,
} from "./agent-state.js";
import { createLoopConfig } from "./loop-config.js";
import { PendingMessageQueue } from "./message-queue.js";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentEvent,
  AgentLoopTurnUpdate,
  AgentMessage,
  AgentState,
  BeforeToolCallContext,
  BeforeToolCallResult,
  QueueMode,
  StreamFn,
  ToolExecutionMode,
} from "./types.js";

export type { QueueMode } from "./types.js";

/**
 * Stateful wrapper around the low-level agent loop.
 *
 * `Agent` owns the current transcript, emits lifecycle events, executes tools,
 * and exposes queueing APIs for steering and follow-up messages.
 */
export class Agent {
  private readonly mutableState: MutableAgentState;
  private readonly runtime: AgentRuntime;

  private readonly steeringQueue: PendingMessageQueue;
  private readonly followUpQueue: PendingMessageQueue;

  public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  public transformContext?: (
    messages: AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<AgentMessage[]>;
  public streamFn: StreamFn;
  public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  public onPayload?: SimpleStreamOptions["onPayload"];
  public onResponse?: SimpleStreamOptions["onResponse"];
  public beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
  public afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
  public prepareNextTurn?: (
    signal?: AbortSignal,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;

  /** Session identifier forwarded to providers for cache-aware backends. */
  public sessionId?: string;
  /** Optional per-level thinking token budgets forwarded to the stream function. */
  public thinkingBudgets?: ThinkingBudgets;
  /** Preferred transport forwarded to the stream function. */
  public transport: Transport;
  /** Optional cap for provider-requested retry delays. */
  public maxRetryDelayMs?: number;
  /** Tool execution strategy for assistant messages that contain multiple tool calls. */
  public toolExecution: ToolExecutionMode;

  constructor(options: AgentOptions = {}) {
    this.mutableState = createMutableAgentState(options.initialState);
    this.runtime = new AgentRuntime(this.mutableState);
    this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = options.transformContext;
    this.streamFn = options.streamFn ?? streamSimple;
    this.getApiKey = options.getApiKey;
    this.onPayload = options.onPayload;
    this.onResponse = options.onResponse;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.prepareNextTurn = options.prepareNextTurn;
    this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
    this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
    this.sessionId = options.sessionId;
    this.thinkingBudgets = options.thinkingBudgets;
    this.transport = options.transport ?? "auto";
    this.maxRetryDelayMs = options.maxRetryDelayMs;
    this.toolExecution = options.toolExecution ?? "parallel";
  }

  /**
   * Subscribe to agent lifecycle events.
   *
   * Listener promises are awaited in subscription order and are included in
   * the current run's settlement. Listeners also receive the active abort
   * signal for the current run.
   *
   * `agent_end` is the final emitted event for a run, but the agent does not
   * become idle until all awaited listeners for that event have settled.
   */
  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void {
    return this.runtime.subscribe(listener);
  }

  /**
   * Current agent state.
   *
   * Assigning `state.tools` or `state.messages` copies the provided top-level array.
   */
  get state(): AgentState {
    return this.mutableState;
  }

  /** Controls how queued steering messages are drained. */
  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  /** Controls how queued follow-up messages are drained. */
  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  /** Queue a message to be injected after the current assistant turn finishes. */
  steer(message: AgentMessage, options?: { mode?: string }): void {
    if (options?.mode === "redirect") {
      this.clearAllQueues();
    }
    this.steeringQueue.enqueue(message);
  }

  /** Queue a message to run only after the agent would otherwise stop. */
  followUp(message: AgentMessage): void {
    this.followUpQueue.enqueue(message);
  }

  /** Remove all queued steering messages. */
  clearSteeringQueue(): void {
    this.steeringQueue.clear();
  }

  /** Remove all queued follow-up messages. */
  clearFollowUpQueue(): void {
    this.followUpQueue.clear();
  }

  /** Remove all queued steering and follow-up messages. */
  clearAllQueues(): void {
    this.clearSteeringQueue();
    this.clearFollowUpQueue();
  }

  /** Returns true when either queue still contains pending messages. */
  hasQueuedMessages(): boolean {
    return this.steeringQueue.hasItems() || this.followUpQueue.hasItems();
  }

  /** Active abort signal for the current run, if any. */
  get signal(): AbortSignal | undefined {
    return this.runtime.signal;
  }

  /** Abort the current run, if one is active. */
  abort(): void {
    this.runtime.abort();
  }

  /**
   * Resolve when the current run and all awaited event listeners have finished.
   *
   * This resolves after `agent_end` listeners settle.
   */
  waitForIdle(): Promise<void> {
    return this.runtime.waitForIdle();
  }

  /** Clear transcript state, runtime state, and queued messages. */
  reset(): void {
    this.mutableState.messages = [];
    this.mutableState.isStreaming = false;
    this.mutableState.streamingMessage = undefined;
    this.mutableState.pendingToolCalls = new Set<string>();
    this.mutableState.errorMessage = undefined;
    this.clearFollowUpQueue();
    this.clearSteeringQueue();
  }

  /** Start a new prompt from text, a single message, or a batch of messages. */
  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): Promise<void> {
    if (this.runtime.isActive) {
      throw new Error(
        "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
      );
    }
    const messages = this.normalizePromptInput(input, images);
    await this.runPromptMessages(messages);
  }

  /** Continue from the current transcript. The last message must be a user or tool-result message. */
  async continue(): Promise<void> {
    if (this.runtime.isActive) {
      throw new Error("Agent is already processing. Wait for completion before continuing.");
    }

    const lastMessage = this.mutableState.messages[this.mutableState.messages.length - 1];
    if (!lastMessage) {
      throw new Error("No messages to continue from");
    }

    if (lastMessage.role === "assistant") {
      const queuedSteering = this.steeringQueue.drain();
      if (queuedSteering.length > 0) {
        await this.runPromptMessages(queuedSteering, { skipInitialSteeringPoll: true });
        return;
      }

      const queuedFollowUps = this.followUpQueue.drain();
      if (queuedFollowUps.length > 0) {
        await this.runPromptMessages(queuedFollowUps);
        return;
      }

      throw new Error("Cannot continue from message role: assistant");
    }

    await this.runContinuation();
  }

  private normalizePromptInput(
    input: string | AgentMessage | AgentMessage[],
    images?: ImageContent[],
  ): AgentMessage[] {
    if (Array.isArray(input)) {
      return input;
    }

    if (typeof input !== "string") {
      return [input];
    }

    const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
    if (images && images.length > 0) {
      content.push(...images);
    }
    return [{ role: "user", content, timestamp: Date.now() }];
  }

  private async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): Promise<void> {
    await this.runtime.run(async (signal) => {
      await runAgentLoop(
        messages,
        this.createContextSnapshot(),
        createLoopConfig(
          this,
          {
            steering: () => this.steeringQueue.drain(),
            followUp: () => this.followUpQueue.drain(),
          },
          options,
        ),
        (event) => this.runtime.emit(event),
        signal,
        this.streamFn,
      );
    });
  }

  private async runContinuation(): Promise<void> {
    await this.runtime.run(async (signal) => {
      await runAgentLoopContinue(
        this.createContextSnapshot(),
        createLoopConfig(this, {
          steering: () => this.steeringQueue.drain(),
          followUp: () => this.followUpQueue.drain(),
        }),
        (event) => this.runtime.emit(event),
        signal,
        this.streamFn,
      );
    });
  }

  private createContextSnapshot(): AgentContext {
    return {
      systemPrompt: this.mutableState.systemPrompt,
      messages: this.mutableState.messages.slice(),
      tools: this.mutableState.tools.slice(),
    };
  }
}

export type { AgentOptions } from "./agent-options.js";
