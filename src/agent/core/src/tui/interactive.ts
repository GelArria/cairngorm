import * as readline from "node:readline";
import type { AgentEvent, AgentState } from "../agent/types.js";
import { Agent } from "../agent/agent.js";

interface InteractiveOptions {
  profile: string;
  isSidecar: boolean;
}

export async function runInteractive(agent: Agent, opts: InteractiveOptions): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  // Subscribe to agent events for terminal output
  let currentMsgId = "";
  let inToolCall = false;

  // In sidecar mode, skip TUI output — the sidecar subscriber handles JSONL on stdout
  if (!opts.isSidecar) {
    agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case "agent_start":
          process.stderr.write("\x1b[2m⏳ thinking...\x1b[0m\r");
          break;

        case "message_start":
          if (event.message.role === "assistant") {
            currentMsgId = "active";
            process.stderr.write("\x1b[2K\r");
          }
          break;

        case "message_update": {
          const e = event.assistantMessageEvent;
          if (e.type === "text_delta") {
            process.stdout.write(e.delta);
          } else if (e.type === "toolcall_start") {
            if (!inToolCall) {
              process.stdout.write("\n");
            }
            inToolCall = true;
          }
          break;
        }

        case "tool_execution_start":
          process.stderr.write(`\x1b[33m● \x1b[1m${event.toolName}\x1b[0m `);
          break;

        case "tool_execution_end":
          process.stderr.write(event.isError ? "\x1b[31m✗\x1b[0m\n" : "\x1b[32m✓\x1b[0m\n");
          break;

        case "turn_end":
          inToolCall = false;
          process.stdout.write("\n\n");
          break;

        case "agent_end":
          currentMsgId = "";
          rl.prompt();
          break;
      }
    });

    const state: AgentState = agent.state;
    process.stdout.write(`\x1b[1mcairngorm-agent\x1b[0m · ${state.model.id} · ${opts.profile}\n`);
    process.stdout.write("Type a message, /help for commands, Ctrl+C to exit\n\n");
    rl.prompt();
  }

  // Handle input
  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    // Slash commands
    if (input.startsWith("/")) {
      const handled = handleSlashCommand(agent, input);
      if (handled) {
        rl.prompt();
        continue;
      }
    }

    // Send to agent
    try {
      await agent.prompt(input);
    } catch (err: any) {
      process.stderr.write(`\x1b[31mError: ${err.message}\x1b[0m\n\n`);
      rl.prompt();
    }
  }
}

function handleSlashCommand(agent: Agent, input: string): boolean {
  const [cmd, ...rest] = input.split(" ");

  switch (cmd) {
    case "/help":
      process.stdout.write("/help    Show commands\n");
      process.stdout.write("/model   Show current model\n");
      process.stdout.write("/clear   Clear conversation\n");
      process.stdout.write("/status  Show agent state\n");
      process.stdout.write("/exit    Exit agent\n");
      return true;

    case "/model":
      process.stdout.write(`Model: ${agent.state.model.id}\n`);
      return true;

    case "/clear":
      agent.reset();
      process.stdout.write("\x1b[2J\x1b[H"); // clear screen
      process.stdout.write("Conversation cleared.\n");
      return true;

    case "/status": {
      const s = agent.state;
      process.stdout.write(`Model: ${s.model.id}\n`);
      process.stdout.write(`Messages: ${s.messages.length}\n`);
      process.stdout.write(`Streaming: ${s.isStreaming}\n`);
      process.stdout.write(`Tools: ${s.tools.map((t) => t.name).join(", ")}\n`);
      return true;
    }

    case "/exit":
      process.exit(0);

    default:
      process.stderr.write(`Unknown command: ${cmd}\n`);
      return true;
  }
}

export { readline };
export function createReadlineInterface() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}
export function formatOutput(text: string) {
  return text;
}
