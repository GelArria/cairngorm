// Explicit scratch-only MCP client, launched inside a real Cairngorm PTY. No model is used.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

async function main() {
  const command = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  assert(process.env.CAIRNGORM_TERMINAL, "Run this driver inside its scratch Cairngorm terminal");
  assert(command.bridge.endsWith("mcp-bridge.cjs"));
  assert(
    path.resolve(command.output).startsWith(path.dirname(path.resolve(process.argv[2])) + path.sep),
  );
  const bridgeArgs = [command.bridge];
  if (command.client) {
    assert.match(command.client, /^[a-f0-9-]{36}$/i);
    bridgeArgs.push("--client", command.client);
  }
  const child = spawn(process.execPath, bridgeArgs, { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let next = 1;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4096);
  });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      message.error
        ? request.reject(Error(message.error.message))
        : request.resolve(message.result);
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => reject(Error(`${method} timed out`)), 60000);
      pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pi", version: "scratch-check" },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    const tools = await request("tools/list", {});
    assert(
      tools.tools.some((tool) => tool.name === command.tool),
      `${command.tool} is not exposed`,
    );
    const result = await request("tools/call", {
      name: command.tool,
      arguments: command.arguments,
    });
    fs.writeFileSync(command.output, JSON.stringify({ result }, null, 2));
    assert(!result.isError, "The upstream tool returned an error; inspect the scratch result");
    console.log("Scratch MCP call completed.");
  } catch (error) {
    const message = String(error.message).replace(/Bearer\s+\S+/gi, "Bearer <REDACTED>");
    fs.writeFileSync(
      command.output,
      JSON.stringify(
        { error: message, bridgeStderr: stderr.replace(/Bearer\s+\S+/gi, "Bearer <REDACTED>") },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    child.kill();
    lines.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
