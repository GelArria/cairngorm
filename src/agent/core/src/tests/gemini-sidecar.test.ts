import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const fixture = fileURLToPath(new URL("./fixtures/gemini-stub.mjs", import.meta.url));
async function launch(prompts: string[], stop = false) {
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "logs", "gemini-engine-"));
  const child = spawn(
    process.execPath,
    [
      path.join(root, "src/agent/core/src/cli.ts"),
      "--sidecar",
      "--gemini",
      "--session-id",
      "native-test",
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        USERPROFILE: dir,
        HOME: dir,
        GEMINI_API_KEY: "",
        GEMINI_CLI_HOME: dir,
        CAIRNGORM_SESSION_REPORT: path.join(dir, "report.json"),
        CAIRNGORM_GEMINI_COMMAND: JSON.stringify({
          program: process.execPath,
          args: [fixture, "--approval-mode", "auto_edit"],
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

test("Gemini CLI engine needs no API key, streams replies and tools and resumes its session", async () => {
  const prompt = "quoted '; --help\nsecond line";
  const { events, calls, dir } = await launch([prompt, "follow up"]);
  expect(calls.map((c) => c.prompt)).toEqual([prompt, "follow up"]);
  expect(calls.every((c) => c.cwd === dir && c.home === dir)).toBe(true);
  // The pane's session hook must never claim the agent tab as a Gemini CLI session.
  expect(calls.every((c) => c.report === null)).toBe(true);
  expect(calls.every((c) => c.args.includes("stream-json"))).toBe(true);
  expect(calls[0].args).toContain("auto_edit");
  expect(calls[0].args).not.toContain("--resume");
  expect(calls[1].args.slice(-2)).toEqual(["--resume", "11111111-2222-3333-4444-555555555555"]);
  expect(events.filter((e) => e.type === "agent_end")).toHaveLength(2);
  expect(events.filter((e) => e.type === "tool_execution_end" && !e.isError)).toHaveLength(2);
  expect(
    events.filter((e) => e.type === "message_update").map((e) => e.assistantMessageEvent.delta),
  ).toEqual(["Checking files.", "Reply: " + prompt, "Checking files.", "Reply: follow up"]);
  expect(events.every((e) => e.session_id === "native-test")).toBe(true);
}, 20_000);

test("Gemini quota failure is visible and closes the agent lifecycle", async () => {
  const { events } = await launch(["quota"]);
  const failed = events.find((e) => e.type === "message_end" && e.message.stopReason === "error");
  expect(failed.message.errorMessage).toContain("usage limit");
  expect(events.at(-1).type).toBe("agent_end");
}, 20_000);

test("an untrusted folder is explained without forwarding stderr", async () => {
  const { events } = await launch(["untrusted"]);
  const failed = events.find((e) => e.type === "message_end" && e.message.stopReason === "error");
  expect(failed.message.errorMessage).toContain("does not trust this folder");
  expect(JSON.stringify(events)).not.toContain("trusted directory");
}, 20_000);

test("stop kills the active Gemini CLI process and the next prompt still runs", async () => {
  const { events, calls } = await launch([], true);
  expect(calls.map((c) => c.prompt)).toEqual(["hang", "after stop"]);
  expect(events.filter((e) => e.type === "agent_end")).toHaveLength(2);
  expect(
    events.some(
      (e) => e.type === "message_update" && e.assistantMessageEvent.delta === "Reply: after stop",
    ),
  ).toBe(true);
}, 20_000);
