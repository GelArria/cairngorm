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
      home: process.env.GEMINI_CLI_HOME,
      report: process.env.CAIRNGORM_SESSION_REPORT ?? null,
    }) + "\n",
  );
  if (prompt === "untrusted") {
    console.error("Gemini CLI is not running in a trusted directory.");
    process.exitCode = 55;
    return;
  }
  const emit = (event) => console.log(JSON.stringify({ ...event, timestamp: "now" }));
  emit({ type: "init", session_id: "11111111-2222-3333-4444-555555555555", model: "stub" });
  emit({ type: "message", role: "user", content: prompt });
  if (prompt === "quota") {
    emit({ type: "error", severity: "error", message: "You have exhausted your daily quota." });
    emit({ type: "result", status: "error", error: { type: "Quota", message: "exhausted" } });
    process.exitCode = 1;
    return;
  }
  emit({ type: "message", role: "assistant", content: "Checking ", delta: true });
  emit({ type: "message", role: "assistant", content: "files.", delta: true });
  emit({ type: "tool_use", tool_name: "read_file", tool_id: "t1", parameters: { path: "a" } });
  if (prompt === "hang") {
    setTimeout(() => {}, 120_000);
    return;
  }
  emit({ type: "tool_result", tool_id: "t1", status: "success", output: "contents" });
  emit({ type: "message", role: "assistant", content: "Reply: " + prompt, delta: true });
  emit({ type: "result", status: "success", stats: { total_tokens: 2 } });
});
