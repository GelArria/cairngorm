import type { AgentEvent } from "../types.js";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;
