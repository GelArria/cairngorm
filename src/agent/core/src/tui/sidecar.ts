import { errorMessage } from "../ai/utils/error-message.js";
import * as readline from "node:readline";
import { Agent } from "../agent/agent.js";

interface SidecarCommand {
  type: string;
  content?: string;
  instruction?: string;
  mode?: string;
}

export async function runSidecar(
  agent: Agent,
  sessionId: string,
  input?: NodeJS.ReadableStream,
): Promise<void> {
  const rl = readline.createInterface({ input: input ?? process.stdin, terminal: false });

  let isRunning = false;
  const queue: string[] = [];

  function startRun(content: string): void {
    if (isRunning) {
      queue.push(content);
      return;
    }
    isRunning = true;
    agent
      .prompt(content)
      .then(() => {
        isRunning = false;
        if (queue.length > 0) {
          const next = queue.shift();
          if (next) {
            startRun(next);
          }
        }
      })
      .catch((err: unknown) => {
        isRunning = false;
        const msg = errorMessage(err);
        process.stderr.write(`Error: ${msg}\n`);
        if (queue.length > 0) {
          const next = queue.shift();
          if (next) {
            startRun(next);
          }
        }
      });
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    // Try JSON first; fall back to treating raw text as a prompt
    let cmd: SidecarCommand | null = null;
    if (trimmed[0] === "{") {
      try {
        cmd = JSON.parse(trimmed) as SidecarCommand;
      } catch {
        // Malformed JSON starting with { — report and skip
        process.stderr.write(`Invalid JSON on stdin: ${trimmed}\n`);
        continue;
      }
    }

    if (!cmd) {
      // Plain text input — treat as a prompt
      cmd = { type: "prompt", content: trimmed };
    }

    if (cmd.type === "prompt" && typeof cmd.content === "string") {
      startRun(cmd.content);
    } else if (cmd.type === "steer") {
      agent.steer(
        { role: "user", content: cmd.instruction ?? "", timestamp: Date.now() },
        { mode: cmd.mode },
      );
      process.stdout.write(
        JSON.stringify({
          type: "steering_received",
          session_id: sessionId,
          instruction: cmd.instruction,
          mode: cmd.mode,
        }) + "\n",
      );
    }
  }
}
