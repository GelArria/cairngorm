import type { Agent } from "../agent/agent.js";

/** Scheduled runs expose a bounded final answer, never a successful dispatch alone. */
export function scheduledResult(messages: readonly unknown[]) {
  const assistants = messages.filter(
    (message): message is Record<string, unknown> =>
      !!message && typeof message === "object" && "role" in message && message.role === "assistant",
  );
  const failed = assistants.find((message) =>
    ["error", "aborted"].includes(String(message.stopReason)),
  );
  const last = failed ?? assistants.at(-1);
  const content = Array.isArray(last?.content) ? last.content : [];
  const text = content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  return {
    success: !failed && last?.stopReason === "stop",
    output: Array.from(String(last?.errorMessage ?? text ?? ""))
      .slice(0, 16_000)
      .join(""),
  };
}

export function reportScheduledResult(messages: readonly unknown[]) {
  const result = scheduledResult(messages);
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.success) {
    process.exitCode = 1;
  }
}

export async function runScheduled(agent: Agent) {
  console.log = (...args: unknown[]) => process.stderr.write(args.map(String).join(" ") + "\n");
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 100_000) {
      throw new Error("Scheduled input is too large.");
    }
  }
  const command = JSON.parse(input);
  if (command.type !== "prompt" || typeof command.content !== "string" || !command.content.trim()) {
    throw new Error("Scheduled runs require task instructions.");
  }
  await agent.prompt(command.content);
  reportScheduledResult(agent.state.messages);
}
