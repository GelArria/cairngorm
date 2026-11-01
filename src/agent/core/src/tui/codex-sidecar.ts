import { runCliSidecar, type CliEngine } from "./cli-sidecar.js";

const TOOL_ITEMS = ["command_execution", "file_change", "mcp_tool_call", "web_search"];

export const codexEngine: CliEngine = {
  name: "Codex",
  commandEnv: "CAIRNGORM_CODEX_COMMAND",
  model: "Codex · CLI subscription",
  profile: "workspace-write · external approvals denied",
  args: (thread) => [
    "exec",
    ...(thread ? ["resume"] : []),
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    ...(thread ? [thread] : []),
    "-",
  ],
  env: (base) => base,
  reader: (turn) => ({
    read(event) {
      if (event.type === "thread.started") {
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(event.thread_id ?? "")) {
          throw new Error("Invalid Codex session metadata.");
        }
        turn.setSession(event.thread_id);
      }
      const item = event.item;
      if (item && ["item.started", "item.completed"].includes(event.type)) {
        if (item.type === "agent_message" && event.type === "item.completed") {
          turn.reply(String(item.text ?? ""));
        } else if (TOOL_ITEMS.includes(item.type)) {
          const id = String(item.id);
          turn.toolStart(id, item.type, item.command ?? JSON.stringify(item.changes ?? []));
          if (event.type === "item.completed") {
            turn.toolEnd(
              id,
              String(item.aggregated_output ?? JSON.stringify(item.changes ?? [])),
              item.status === "failed" ||
                (typeof item.exit_code === "number" && item.exit_code !== 0),
            );
          }
        }
      }
      if (event.type === "turn.failed" || event.type === "error") {
        const reason = String(event.message ?? event.error?.message ?? "");
        turn.fail(
          /usage limit/i.test(reason)
            ? "Codex usage limit reached. Check ChatGPT → Settings → Usage or wait for your quota to reset."
            : "Codex could not complete the request. Check your CLI login and quota in AI providers.",
        );
      }
    },
    finish() {},
  }),
};

export function runCodexSidecar(sessionId: string, input: NodeJS.ReadableStream = process.stdin) {
  return runCliSidecar(codexEngine, sessionId, input);
}
