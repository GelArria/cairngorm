import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceTools, workspacePath } from "../tools/workspace-policy.js";
import { shellEnvironment } from "../tools/shell-environment.js";
import { websocketChunks } from "../ai/providers/openai-websocket.js";

test("BYOK tools reject outside paths, credentials and linked files while editing the workspace", async () => {
  const parent = mkdtempSync(join(tmpdir(), "cairngorm-boundary-"));
  const root = join(parent, "project");
  mkdirSync(root);
  const outside = join(parent, "private.txt");
  writeFileSync(outside, "private");
  try {
    const tools = workspaceTools(root);
    expect(tools.some((tool) => tool.name === "bash")).toBe(false);
    expect(() => workspacePath(root, outside)).toThrow("project folder");
    expect(() => workspacePath(root, ".env")).toThrow("credential");
    symlinkSync(parent, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect(() => workspacePath(root, "escape/private.txt")).toThrow("links");
    linkSync(outside, join(root, "hardlink.txt"));
    expect(() => workspacePath(root, "hardlink.txt")).toThrow("links");
    const write = tools.find((tool) => tool.name === "file-write")!;
    await write.execute("write", { path: "nested/allowed.txt", content: "ok" });
    expect(readFileSync(join(root, "nested/allowed.txt"), "utf8")).toBe("ok");
    expect(() => write.execute("bad", { path: outside, content: "stolen" })).toThrow();
    const grep = tools.find((tool) => tool.name === "grep")!;
    writeFileSync(join(root, ".env"), "private");
    const result = await grep.execute("grep", { path: ".", pattern: "private" });
    expect(JSON.stringify(result)).not.toContain("private.txt");
    expect(JSON.stringify(result)).not.toContain(".env");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("shell environment excludes provider, cloud and session secrets", () => {
  expect(
    shellEnvironment({
      PATH: "bin",
      OPENAI_API_KEY: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      CAIRNGORM_AGENT_API_KEY: "secret",
      NODE_OPTIONS: "--require evil",
    }),
  ).toEqual({ PATH: "bin" });
});

test("WebSocket gateway sends a real request and receives Chat Completions chunks", async () => {
  let authorized = false;
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      authorized = request.headers.get("authorization") === "Bearer test-only-key";
      if (server.upgrade(request)) {
        return;
      }
      return new Response("upgrade required", { status: 426 });
    },
    websocket: {
      message(socket, message) {
        expect(JSON.parse(String(message)).model).toBe("test-model");
        socket.send(
          JSON.stringify({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] }),
        );
        socket.send(JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }));
        socket.send("[DONE]");
      },
    },
  });
  try {
    const chunks = [];
    for await (const chunk of websocketChunks(
      `ws://127.0.0.1:${server.port}/chat`,
      "test-only-key",
      { model: "test-model" },
    )) {
      chunks.push(chunk);
    }
    expect(authorized).toBe(true);
    expect(chunks[0].choices[0].delta.content).toBe("Hello");
    expect(chunks[1].choices[0].finish_reason).toBe("stop");
    const controller = new AbortController();
    controller.abort();
    const aborted = websocketChunks(
      `ws://127.0.0.1:${server.port}`,
      "test",
      {},
      { signal: controller.signal },
    );
    await expect(aborted.next()).rejects.toThrow("aborted");
  } finally {
    await server.stop(true);
  }
});
