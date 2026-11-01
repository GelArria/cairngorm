import fs from "node:fs";
import path from "node:path";
let prompt = "";
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  fs.appendFileSync(
    path.join(process.cwd(), "calls.jsonl"),
    JSON.stringify({
      args: process.argv.slice(2),
      prompt,
      cwd: process.cwd(),
      home: process.env.CODEX_HOME,
    }) + "\n",
  );
  if (!process.argv.includes("--ignore-user-config") || !process.argv.includes("--ignore-rules")) {
    console.error("invalid transport in inherited config");
    process.exitCode = 1;
    return;
  }
  const emit = (event) => console.log(JSON.stringify(event));
  emit({ type: "thread.started", thread_id: "11111111-2222-3333-4444-555555555555" });
  emit({ type: "turn.started" });
  if (prompt === "fail") {
    emit({ type: "turn.failed", error: { message: "fixture failure" } });
    process.exitCode = 1;
    return;
  }
  emit({
    type: "item.started",
    item: { id: "cmd1", type: "command_execution", command: "inspect workspace" },
  });
  if (prompt === "hang") {
    setTimeout(() => {}, 120_000);
    return;
  }
  emit({
    type: "item.completed",
    item: {
      id: "cmd1",
      type: "command_execution",
      aggregated_output: "workspace checked",
      exit_code: 0,
      status: "completed",
    },
  });
  emit({
    type: "item.completed",
    item: { id: "msg1", type: "agent_message", text: "Reply: " + prompt },
  });
  emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
});
