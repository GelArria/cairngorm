#!/usr/bin/env node
// Cairngorm plugins MCP bridge: stdio (any agent CLI) <-> the running app's local gateway.
// Installed and updated by Cairngorm; no dependencies, Node 18+ or Bun.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const GATEWAY_FILE = path.join(__dirname, "gateway.json");
const PROTOCOL = "2025-06-18";

// Re-read per message: restarting Cairngorm gives the gateway a new port and secret.
function gateway() {
  try {
    const value = JSON.parse(fs.readFileSync(GATEWAY_FILE, "utf8"));
    return typeof value.url === "string" && typeof value.secret === "string" ? value : null;
  } catch {
    return null;
  }
}

// The agent names itself in the MCP handshake (clientInfo); Cairngorm uses it to show
// which agent drew what. Header-safe characters only.
let client = "";
const registration =
  process.argv[2] === "--client" && /^[a-f0-9-]{36}$/i.test(process.argv[3] ?? "")
    ? process.argv[3]
    : "";
let initialization = null;
let remoteKey = "";
let reconnecting = null;
let listedRevision = null;
let notifiedRevision = null;
let polling = false;
let closed = false;
let monitor = null;
// Aborted when the agent exits: Cairngorm sees the connection close and stops the work.
const inflight = new AbortController();
function clientLabel(message) {
  const info = message?.method === "initialize" ? message.params?.clientInfo : null;
  if (!info || typeof info.name !== "string") {
    return null;
  }
  const label = `${info.name}/${typeof info.version === "string" ? info.version : ""}`;
  return label.replace(/[^\w ./@-]/g, "").slice(0, 80);
}
function remember(message) {
  client = clientLabel(message) ?? client;
  if (message?.method === "initialize") {
    initialization = message;
  }
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function forward(message, target = gateway()) {
  if (!target) {
    throw new Error("Cairngorm is not running.");
  }
  const response = await fetch(`${target.url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.secret}`,
      "x-cairngorm-terminal": process.env.CAIRNGORM_TERMINAL ?? "",
      "x-cairngorm-pid": String(process.pid),
      "x-cairngorm-client": client,
      "x-cairngorm-registration": registration,
    },
    body: JSON.stringify(message),
    signal: inflight.signal,
  });
  if (response.status === 202) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Cairngorm refused the request (${response.status}).`);
  }
  return response.json();
}

async function ensureGateway(target) {
  if (!target || !initialization || remoteKey === `${target.url}|${target.secret}`) {
    return;
  }
  if (!reconnecting) {
    reconnecting = (async () => {
      const reply = await forward(initialization, target);
      if (!reply?.result) {
        throw new Error("Could not initialize the Cairngorm gateway");
      }
      remoteKey = `${target.url}|${target.secret}`;
    })().finally(() => {
      reconnecting = null;
    });
  }
  await reconnecting;
}

// Poll only local metadata, never upstream tools. Notifications are standard MCP.
async function watchCatalog() {
  if (closed || polling || !initialization || listedRevision === null) {
    return;
  }
  const target = gateway();
  if (!target) {
    return;
  }
  polling = true;
  try {
    const response = await fetch(`${target.url}/catalog`, {
      headers: { authorization: `Bearer ${target.secret}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return;
    }
    const { revision } = await response.json();
    if (typeof revision !== "string") {
      return;
    }
    await ensureGateway(target);
    if (!closed && revision !== listedRevision && revision !== notifiedRevision) {
      notifiedRevision = revision;
      write({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    }
  } catch {
    // App restarts and temporary unavailability are retried without losing the CLI session.
  } finally {
    polling = false;
  }
}

function rememberResult(message, reply, target) {
  if (message.method === "initialize" && reply?.result && target) {
    remoteKey = `${target.url}|${target.secret}`;
  }
  if (message.method === "tools/list" && Array.isArray(reply?.result?.tools)) {
    listedRevision = reply.result._meta?.["cairngorm/revision"] ?? "offline";
    notifiedRevision = listedRevision;
    if (!monitor && !closed) {
      monitor = setInterval(() => void watchCatalog(), 5000).unref();
    }
  }
}

// Without the app the agent still starts; it simply sees no plugin tools.
function offline(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: message.params?.protocolVersion ?? PROTOCOL,
      capabilities: { tools: { listChanged: true }, resources: {} },
      serverInfo: { name: "cairngorm", version: "1" },
      instructions: "Cairngorm plugins are available when this agent runs in a Cairngorm terminal.",
    };
  }
  if (message.method === "tools/list") {
    return { tools: [] };
  }
  if (message.method === "resources/list") {
    // Keep resource discovery stable across outages; reads still require the app.
    return {
      resources: [
        {
          uri: "cairngorm://plugins",
          name: "Cairngorm plugin capabilities",
          description:
            "Enabled Cairngorm plugins and guidance for using their tools in this terminal",
          mimeType: "application/json",
        },
      ],
    };
  }
  if (message.method === "ping") {
    return {};
  }
  return null;
}

async function handle(message) {
  const request =
    message.id !== undefined && message.id !== null && typeof message.method === "string";
  try {
    const target = gateway();
    if (message.method !== "initialize") {
      await ensureGateway(target);
    }
    const reply = await forward(message, target);
    rememberResult(message, reply, target);
    if (request) {
      write(reply ?? { jsonrpc: "2.0", id: message.id, result: {} });
    }
  } catch (error) {
    if (!request || closed) {
      return;
    }
    const result = offline(message);
    rememberResult(message, { result }, null);
    write(
      result
        ? { jsonrpc: "2.0", id: message.id, result }
        : {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: String(error?.message ?? error) },
          },
    );
  }
}

// Required by tests: expose the pure helper without reading stdin.
if (require.main !== module) {
  module.exports = { clientLabel };
} else {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("close", () => {
    closed = true;
    inflight.abort();
    if (monitor) {
      clearInterval(monitor);
    }
  });
  lines.on("line", (line) => {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    remember(message);
    // Calls run concurrently: a view-backed tool call must not block a ping.
    void handle(message);
  });
}
// Once stdin closes and every reply is written, Node exits on its own. Forcing
// process.exit() while fetch sockets are closing aborts Node on Windows.
