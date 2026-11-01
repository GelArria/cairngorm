import type { AgentEvent, ChatMessage } from "../shared/agent-events";
export interface ChatEntry extends ChatMessage {
  /** Compact arg summary for a tool-execution block. */
  toolArg?: string;
  isError?: boolean;
  /** Prompt header (model line) rather than a text block. */
  isHeader?: boolean;
}

/** First string/number value of the args object, for the compact tool line. */
function argsText(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "";
  }
  for (const v of Object.values(args as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) {
      return truncate(v);
    }
    if (typeof v === "number") {
      return String(v);
    }
  }
  return "";
}

function truncate(s: string, max = 48): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Flatten a tool result to plain text. */
function resultText(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  if (result && typeof result === "object" && "content" in (result as Record<string, unknown>)) {
    const content = (result as { content: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (c): c is { type: string; text: string } =>
            typeof c === "object" &&
            c !== null &&
            "type" in c &&
            (c as { type: string }).type === "text",
        )
        .map((c) => c.text)
        .join("");
    }
    return JSON.stringify(result);
  }
  return JSON.stringify(result ?? "");
}

/**
 * Rebuild the chat transcript from agent events.
 * Minimal state machine: open text buffer + one running tool slot.
 */
export function buildChatMessages(events: AgentEvent[]): ChatEntry[] {
  // Per-build counter (reviewer: concurrent builds — main + detached window —
  // must not share id state; m0.. stays deterministic per transcript).
  let n = 0;
  const nextId = () => `m${n++}`;
  const msgs: ChatEntry[] = [];
  let currentText = "";
  const flush = (ts: number) => {
    if (currentText) {
      msgs.push({ id: nextId(), role: "assistant", content: currentText.trim(), timestamp: ts });
      currentText = "";
    }
  };

  for (const ev of events) {
    switch (ev.type) {
      case "message_start": {
        const msg = ev.message;
        if (msg.role === "user") {
          currentText = "";
          const text = msg.content.map((c) => (c.type === "text" ? c.text : "")).join("");
          msgs.push({
            id: nextId(),
            role: "user",
            content: text,
            timestamp: msg.timestamp ?? Date.now(),
          });
        }
        break;
      }
      case "message_update": {
        const sub = ev.assistantMessageEvent;
        if (sub?.type === "text_delta" && typeof sub.delta === "string") {
          currentText += sub.delta;
        }
        break;
      }
      case "message_end": {
        const msg = ev.message;
        if (msg.role === "assistant") {
          const stop = msg.stopReason;
          const err =
            stop === "error" ? (msg as { errorMessage?: string }).errorMessage : undefined;
          // Prompt header (model · harness) before the reply block — OpenCode voice.
          // Consecutive headers collapse (multi-message turns announce once).
          if (msg.model && msgs[msgs.length - 1]?.isHeader !== true) {
            msgs.push({
              id: nextId(),
              role: "system",
              content: msg.model,
              isHeader: true,
              timestamp: msg.timestamp ?? Date.now(),
            });
          }
          flush(msg.timestamp ?? Date.now());
          if (err) {
            msgs.push({
              id: nextId(),
              role: "system",
              content: `agent error: ${truncate(err, 120)}`,
              isError: true,
              timestamp: msg.timestamp ?? Date.now(),
            });
          }
        }
        break;
      }
      case "tool_execution_start": {
        flush(ev.timestamp ?? Date.now());
        msgs.push({
          id: nextId(),
          role: "tool",
          content: "",
          toolName: ev.toolName,
          toolArg: argsText(ev.args),
          toolCallId: ev.toolCallId,
          toolStatus: "running",
          timestamp: ev.timestamp ?? Date.now(),
        });
        break;
      }
      case "tool_execution_end": {
        const target = msgs.find(
          (m) => m.role === "tool" && m.toolStatus === "running" && m.toolCallId === ev.toolCallId,
        );
        if (target) {
          target.toolStatus = "ended";
          target.content = resultText(ev.result);
          if (ev.isError) {
            target.isError = true;
          }
        }
        break;
      }
      case "turn_end": {
        flush(ev.timestamp ?? Date.now());
        break;
      }
      default:
        break;
    }
  }
  flush(Date.now());
  return msgs;
}
