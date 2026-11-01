import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/codex-stub.mjs", import.meta.url));
async function launch(prompts: string[], stop = false) {
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "logs", "codex-engine-"));
  const child = spawn(
    process.execPath,
    [
      path.join(root, "src/agent/core/src/cli.ts"),
      "--sidecar",
      "--codex",
      "--session-id",
      "native-test",
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        USERPROFILE: dir,
        HOME: dir,
        OPENAI_API_KEY: "",
        CODEX_HOME: dir,
        CAIRNGORM_CODEX_COMMAND: JSON.stringify({
          program: process.execPath,
          args: [fixture, "-c", 'sandbox_mode="workspace-write"'],
        }),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const done = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const events: any[] = [];
  let errors = "";
  child.stderr.on("data", (data) => {
    errors += data;
  });
  if (!stop) {
    for (const content of prompts) {
      child.stdin.write(JSON.stringify({ type: "prompt", content }) + "\n");
    }
    child.stdin.end();
  } else {
    child.stdin.write(JSON.stringify({ type: "prompt", content: "hang" }) + "\n");
  }
  const timeout = setTimeout(() => child.kill(), 15_000);
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const event = JSON.parse(line);
      events.push(event);
      if (stop && event.type === "tool_execution_start") {
        stop = false;
        child.stdin.write(
          JSON.stringify({ type: "steer", mode: "stop", instruction: "stop" }) + "\n",
        );
        child.stdin.end(JSON.stringify({ type: "prompt", content: "after stop" }) + "\n");
      }
    }
    expect(await done, errors).toBe(0);
    const calls = fs
      .readFileSync(path.join(dir, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(fs.existsSync(path.join(dir, ".panel/agent/config.json"))).toBe(false);
    return { events, calls, dir };
  } finally {
    clearTimeout(timeout);
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("Codex native engine needs no API key, preserves prompts/cwd, streams tools and resumes its own thread", async () => {
  const prompt = "quoted '; --help\nsecond line";
  const { events, calls, dir } = await launch([prompt, "follow up"]);
  expect(calls.map((c) => c.prompt)).toEqual([prompt, "follow up"]);
  expect(calls.every((c) => c.cwd === dir && c.home === dir)).toBe(true);
  expect(calls[0].args).toContain('sandbox_mode="workspace-write"');
  expect(
    calls.every(
      (c) => c.args.includes("--ignore-user-config") && c.args.includes("--ignore-rules"),
    ),
  ).toBe(true);
  expect(calls[1].args).toContain("resume");
  expect(calls[1].args).toContain("11111111-2222-3333-4444-555555555555");
  expect(calls[1].args.at(-1)).toBe("-");
  expect(events.filter((e) => e.type === "agent_end")).toHaveLength(2);
  expect(events.filter((e) => e.type === "tool_execution_end" && !e.isError)).toHaveLength(2);
  expect(
    events.filter((e) => e.type === "message_update").map((e) => e.assistantMessageEvent.delta),
  ).toEqual(["Reply: " + prompt, "Reply: follow up"]);
  expect(events.every((e) => e.session_id === "native-test")).toBe(true);
  expect(new Set(events.map((e) => e.sequence)).size).toBe(events.length);
}, 20_000);

test("identical replies and lifecycle events remain distinct for PTY deduplication", async () => {
  const { events } = await launch(["same", "same"]);
  expect(events.filter((e) => e.type === "agent_start")).toHaveLength(2);
  expect(events.filter((e) => e.type === "message_update")).toHaveLength(2);
  expect(new Set(events.map((e) => JSON.stringify(e))).size).toBe(events.length);
}, 20_000);

test("Codex failure is visible and closes the agent lifecycle", async () => {
  const { events } = await launch(["fail"]);
  expect(events.some((e) => e.type === "message_end" && e.message.stopReason === "error")).toBe(
    true,
  );
  expect(events.at(-1).type).toBe("agent_end");
}, 20_000);

test("stop kills the active Codex process and the next prompt still runs", async () => {
  const { events, calls } = await launch([], true);
  expect(calls.map((c) => c.prompt)).toEqual(["hang", "after stop"]);
  expect(events.filter((e) => e.type === "agent_end")).toHaveLength(2);
  expect(
    events.some(
      (e) => e.type === "message_update" && e.assistantMessageEvent.delta === "Reply: after stop",
    ),
  ).toBe(true);
}, 20_000);
