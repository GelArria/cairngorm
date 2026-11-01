#!/usr/bin/env bun
/**
 * cairngorm-agent — Agent CLI that runs as a Tauri sidecar.
 *
 * Usage:
 *   cairngorm-agent                                # Interactive mode (TUI)
 *   cairngorm-agent --sidecar                      # Sidecar mode (JSONL stdin/stdout)
 *   cairngorm-agent --sidecar --session-id <id>    # Sidecar with explicit session ID
 *   cairngorm-agent --profile <id>                 # Start with specific agent profile
 *   cairngorm-agent --model <id>                   # Override model
 */
import { Agent } from "./agent/agent.js";
import { streamSimple } from "./ai/stream.js";
import { getEnvApiKey } from "./ai/env-api-keys.js";
import type { AgentEvent, AgentTool, ThinkingLevel } from "./agent/types.js";
import type { Model } from "./ai/types.js";
import { runInteractive } from "./tui/interactive.js";
import { runSidecar } from "./tui/sidecar.js";
import { runScheduled } from "./tui/scheduled.js";
import { resolveModel } from "./model-resolver.js";
import { allTools } from "./tools/index.js";
import { workspaceTools } from "./tools/workspace-policy.js";
import { ensureConfig } from "./config.js";
import crypto from "node:crypto";

const launchArgs = process.argv.slice(2);
if (launchArgs.includes("--codex") || launchArgs.includes("--gemini")) {
  const gemini = launchArgs.includes("--gemini");
  if (!launchArgs.includes("--sidecar")) {
    throw new Error(`${gemini ? "Gemini CLI" : "Codex"} engine requires sidecar mode.`);
  }
  const sessionId =
    launchArgs.find((_, i) => launchArgs[i - 1] === "--session-id") ?? crypto.randomUUID();
  if (gemini) {
    const { runGeminiSidecar } = await import("./tui/gemini-sidecar.js");
    await runGeminiSidecar(sessionId);
  } else {
    const { runCodexSidecar } = await import("./tui/codex-sidecar.js");
    await runCodexSidecar(sessionId);
  }
  process.exit(process.exitCode ?? 0);
}

// ── Config (auto-generates on first run) ──────────────────────────────────
const config = ensureConfig();

// ── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isSidecar = args.includes("--sidecar");
const profileArg = args.find((a, i) => args[i - 1] === "--profile") ?? config.defaultProfile;
const modelArg = args.find((a, i) => args[i - 1] === "--model") ?? undefined;
const sessionIdArg = args.find((a, i) => args[i - 1] === "--session-id");

// ── Model resolution ─────────────────────────────────────────────────────
const { model, apiKey } = resolveModel(config, modelArg);
// Keep credentials in the model closure, away from spawned tool environments.
delete process.env.CAIRNGORM_AGENT_API_KEY;
delete process.env.CAIRNGORM_AGENT_KEY_ENV;
if (!apiKey) {
  console.error(
    `Configure your provider, model and API key in Settings › Agent (or set ${config.apiKeyEnv} for an explicitly configured provider).`,
  );
  process.exit(1);
}

// ── Session ID ────────────────────────────────────────────────────────────
function generateSessionId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const sessionId = sessionIdArg ?? generateSessionId();

// ── Agent setup ───────────────────────────────────────────────────────────
// Shell execution is an explicit trusted-project opt-in, never the BYOK default.
const tools = workspaceTools(process.cwd(), config.allowShell === true);
const agent = new Agent({
  initialState: {
    model,
    systemPrompt: config.profiles[profileArg] ?? config.profiles[config.defaultProfile]!,
    tools,
    thinkingLevel: config.thinkingLevel as ThinkingLevel,
  },
  streamFn: streamSimple,
  getApiKey: async (provider: string) => {
    return provider === model.provider ? apiKey : undefined;
  },
  convertToLlm: (messages) => {
    return messages.filter(
      (m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult",
    );
  },
  toolExecution: config.toolExecution,
  steeringMode: "one-at-a-time",
  followUpMode: "one-at-a-time",
  sessionId,
});

// ── Event logging (sidecar mode) ─────────────────────────────────────────
// Follows pi's rpc-mode.ts pattern: serialize the full event object as JSONL.
// Non-serializable fields (function refs in tools) are stripped to plain objects.
function serializeSidecarEvent(event: AgentEvent, sid: string): string {
  const payload: Record<string, unknown> = { ...event, session_id: sid };
  delete (payload as Record<string, unknown>).sessionId;
  if (event.type === "agent_start" && event.tools) {
    payload.tools = event.tools.map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
    }));
  }
  // Wire slimming for message_update: the loop event embeds the FULL partial
  // message twice (assistantMessageEvent.partial + message). The wire consumers
  // (Rust PTY → xterm/chat) only read {type, delta, contentIndex} — sending
  // both makes every delta line O(message): it floods the xterm with raw JSON
  // once lines outgrow the PTY JSON assembler and defeats ConPTY echo dedup.
  if (event.type === "message_update") {
    const e = event.assistantMessageEvent as {
      type: string;
      delta?: string;
      contentIndex?: number;
    };
    payload.assistantMessageEvent = { type: e.type, delta: e.delta, contentIndex: e.contentIndex };
    delete payload.message;
  }
  return JSON.stringify(payload) + "\n";
}

if (isSidecar && !args.includes("--scheduled")) {
  // Redirect console.* to stderr to prevent stdout JSONL corruption
  console.log = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
  console.error = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");

  // Single output: JSONL events to stdout (Rust PTY parses + generates terminal text)
  agent.subscribe((event: AgentEvent) => {
    try {
      process.stdout.write(serializeSidecarEvent(event, sessionId));
    } catch (err) {
      process.stderr.write(`[sidecar] Failed to serialize event ${event.type}: ${err}\n`);
    }
  });

  // Startup header as a synthetic event so Rust renders it to xterm
  process.stdout.write(
    JSON.stringify({
      type: "sidecar_ready",
      model: model.id,
      profile: profileArg,
      session_id: sessionId,
    }) + "\n",
  );
}

// ── Run mode ──────────────────────────────────────────────────────────────
if (args.includes("--scheduled")) {
  await runScheduled(agent);
} else if (isSidecar) {
  await runSidecar(agent, sessionId);
} else {
  await runInteractive(agent, { profile: profileArg, isSidecar });
}
