import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { reportScheduledResult } from "./scheduled.js";

/** What one subscription CLI turn reports back to the shared sidecar loop. */
export interface CliTurn {
  setSession(id: string): void;
  reply(text: string): void;
  toolStart(id: string, name: string, command: string): void;
  toolEnd(id: string, output: string, isError: boolean): void;
  fail(message: string): void;
}

/** Reads one CLI process's JSONL events; `finish` runs once its output ends. */
export interface CliTurnReader {
  read(event: any): void;
  finish(): void;
}

/** A subscription CLI driven one process per prompt, resuming its own session. */
export interface CliEngine {
  name: string;
  /** Environment variable holding the `{ program, args }` launch prepared by Rust. */
  commandEnv: string;
  model: string;
  profile: string;
  args(session: string | undefined): string[];
  env(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  reader(turn: CliTurn): CliTurnReader;
  /** Explains a failed exit from the CLI's stderr, which is never shown as is. */
  exitFailure?(stderr: string): string | undefined;
}

export async function runCliSidecar(
  engine: CliEngine,
  sessionId: string,
  input: NodeJS.ReadableStream = process.stdin,
) {
  const command = JSON.parse(process.env[engine.commandEnv] ?? "{}");
  if (
    typeof command.program !== "string" ||
    !Array.isArray(command.args) ||
    !command.args.every((v: unknown) => typeof v === "string")
  ) {
    throw new Error(
      `${engine.name} launch configuration is missing. Select and verify ${engine.name} in AI providers.`,
    );
  }
  let sequence = 0;
  const emit = (event: Record<string, unknown>) => {
    if (process.argv.includes("--scheduled")) {
      if (event.type === "agent_end" && Array.isArray(event.messages)) {
        reportScheduledResult(event.messages);
      }
      return;
    }
    process.stdout.write(
      JSON.stringify({ ...event, sequence: ++sequence, session_id: sessionId }) + "\n",
    );
  };
  let session: string | undefined;
  let child: ChildProcess | undefined;
  let queue = Promise.resolve();
  let epoch = 0;
  const abort = () => {
    epoch++;
    if (!child?.pid) {
      return;
    }
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  };
  const onTerminate = () => {
    abort();
    process.exit(0);
  };
  process.once("SIGTERM", onTerminate);
  process.once("SIGINT", onTerminate);
  emit({ type: "sidecar_ready", model: engine.model, profile: engine.profile });

  const run = async (prompt: string) => {
    emit({ type: "agent_start" });
    emit({ type: "turn_start" });
    emit({
      type: "message_start",
      message: { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() },
    });
    const messages: Record<string, unknown>[] = [];
    const tools = new Map<string, string>();
    let failure = "";
    const reply = (text: string, error = false) => {
      const message = {
        role: "assistant",
        content: [{ type: "text", text }],
        model: engine.name,
        timestamp: Date.now(),
        stopReason: error ? "error" : "stop",
        ...(error ? { errorMessage: text } : {}),
      };
      if (!error) {
        emit({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: text, contentIndex: 0 },
        });
      }
      emit({ type: "message_end", message });
      messages.push(message);
    };
    const turn: CliTurn = {
      setSession: (id) => {
        session = id;
      },
      reply: (text) => reply(text),
      toolStart: (id, name, command) => {
        if (!tools.has(id)) {
          tools.set(id, name);
          emit({ type: "tool_execution_start", toolCallId: id, toolName: name, args: { command } });
        }
      },
      toolEnd: (id, output, isError) => {
        const name = tools.get(id) ?? engine.name;
        tools.delete(id);
        emit({
          type: "tool_execution_end",
          toolCallId: id,
          toolName: name,
          result: { content: [{ type: "text", text: output.slice(0, 32_000) }] },
          isError,
        });
      },
      fail: (message) => {
        failure = message;
      },
    };
    try {
      child = spawn(command.program, [...command.args, ...engine.args(session)], {
        cwd: process.cwd(),
        env: engine.env(process.env),
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const current = child;
      const done = new Promise<number | null>((resolve) => {
        current.once("error", () => {
          failure = `Could not start ${engine.name}. Check its executable in AI providers.`;
          resolve(null);
        });
        current.once("close", resolve);
      });
      // Drain stderr without forwarding possible account metadata to the UI; the engine
      // only classifies a bounded copy.
      let stderr = "";
      current.stderr!.on("data", (chunk) => {
        if (stderr.length < 64_000) {
          stderr += String(chunk);
        }
      });
      current.stdin!.on("error", () => {});
      current.stdin!.end(prompt);
      const timeout = setTimeout(abort, 10 * 60_000);
      const reader = engine.reader(turn);
      try {
        for await (const line of createInterface({ input: current.stdout! })) {
          if (line.length > 1_000_000) {
            abort();
            throw new Error(`${engine.name} returned an oversized event.`);
          }
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event && typeof event === "object") {
            reader.read(event);
          }
        }
        reader.finish();
        const code = await done;
        if (code !== 0 && !failure) {
          failure = engine.exitFailure?.(stderr) ?? "";
        }
        if (code !== 0 && !failure) {
          failure = `${engine.name} exited with code ${code ?? "unknown"}. Check AI providers or retry.`;
        }
        if (failure) {
          reply(failure, true);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      reply(
        `Could not run ${engine.name}. Check its executable, login and configuration in AI providers.`,
        true,
      );
      abort();
    } finally {
      child = undefined;
      for (const id of tools.keys()) {
        emit({
          type: "tool_execution_end",
          toolCallId: id,
          toolName: engine.name,
          result: "Interrupted",
          isError: true,
        });
      }
      emit({ type: "turn_end", message: messages.at(-1) ?? {} });
      emit({ type: "agent_end", messages });
    }
  };
  try {
    for await (const line of createInterface({ input, terminal: false })) {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        continue;
      }
      if (!cmd || typeof cmd !== "object") {
        continue;
      }
      if (cmd.type === "steer" && (cmd.mode === "stop" || cmd.instruction === "stop")) {
        abort();
        continue;
      }
      const text =
        cmd.type === "prompt" ? cmd.content : cmd.type === "steer" ? cmd.instruction : undefined;
      if (typeof text !== "string" || !text.trim()) {
        continue;
      }
      const scheduled = epoch;
      queue = queue.then(() => (scheduled === epoch ? run(text) : undefined));
    }
    await queue;
  } finally {
    abort();
    process.removeListener("SIGTERM", onTerminate);
    process.removeListener("SIGINT", onTerminate);
  }
}
