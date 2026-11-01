import { afterEach, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((close) => close());
});

async function setup(offline = false, listDelay = 0) {
  const dir = mkdtempSync(path.join(tmpdir(), "cairngorm-bridge-sync-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "mcp-bridge.cjs");
  copyFileSync(path.resolve("src/plugins/assets/mcp-bridge.cjs"), script);
  let epoch = 1;
  let revision = "epoch-1:0";
  let secret = "test-only-secret";
  let initialized = false;
  const received: { method: string; registration?: string }[] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("content-type", "application/json");
    if (req.url === "/catalog") {
      res.end(JSON.stringify({ revision }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const m = JSON.parse(raw);
    received.push({
      method: m.method,
      registration: req.headers["x-cairngorm-registration"] as string,
    });
    if (m.method === "initialize") {
      initialized = true;
    }
    if (m.method === "tools/list" && listDelay) {
      await new Promise((resolve) => setTimeout(resolve, listDelay));
    }
    const result =
      m.method === "initialize"
        ? {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "cairngorm", version: "1" },
          }
        : m.method === "resources/list"
          ? {
              resources: [
                {
                  uri: "cairngorm://plugins",
                  name: "Cairngorm plugin capabilities",
                  description:
                    "Enabled Cairngorm plugins and guidance for using their tools in this terminal",
                  mimeType: "application/json",
                },
              ],
            }
          : {
              tools: [{ name: revision, inputSchema: { type: "object" } }],
              _meta: { "cairngorm/revision": revision },
            };
    res.end(
      JSON.stringify(
        initialized
          ? { jsonrpc: "2.0", id: m.id, result }
          : { jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "Handshake required" } },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address() as { port: number };
  const discover = () =>
    writeFileSync(
      path.join(dir, "gateway.json"),
      JSON.stringify({ url: `http://127.0.0.1:${address.port}`, secret }),
    );
  if (!offline) discover();
  const id = "12345678-1234-1234-1234-123456789abc";
  const child = spawn(process.execPath, [script, "--client", id], {
    stdio: "pipe",
  }) as ChildProcessWithoutNullStreams;
  cleanup.push(() => child.kill());
  const messages: any[] = [];
  const waiters: {
    match: (m: any) => boolean;
    resolve: (m: any) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const m = JSON.parse(line);
    const index = waiters.findIndex((w) => w.match(m));
    if (index < 0) messages.push(m);
    else {
      const w = waiters.splice(index, 1)[0];
      clearTimeout(w.timer);
      w.resolve(m);
    }
  });
  cleanup.push(() => {
    waiters.forEach((w) => clearTimeout(w.timer));
    lines.close();
  });
  const next = (match: (m: any) => boolean) => {
    const index = messages.findIndex(match);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("MCP bridge response timed out")),
        Math.max(8000, listDelay + 2000),
      );
      waiters.push({ match, resolve, reject, timer });
    });
  };
  const request = async (id: number, method: string, params = {}) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return next((m) => m.id === id);
  };
  return {
    id,
    request,
    next,
    received,
    discover,
    change: () => {
      revision = "epoch-1:1";
    },
    restart: () => {
      epoch += 1;
      revision = `epoch-${epoch}:0`;
      secret = `rotated-test-secret-${epoch}`;
      initialized = false;
      discover();
    },
  };
}

it("an arbitrary MCP client receives standard catalog-change notifications and recovers across app restarts", async () => {
  const bridge = await setup();
  const init = await bridge.request(1, "initialize", {
    clientInfo: { name: "My from-scratch CLI", version: "1" },
  });
  expect(init.result.capabilities.tools.listChanged).toBe(true);
  expect((await bridge.request(2, "tools/list")).result.tools[0].name).toBe("epoch-1:0");
  bridge.change();
  const changed = await bridge.next((m) => m.method === "notifications/tools/list_changed");
  expect(changed).toEqual({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  // The bridge never fabricates a client tools/list while checking local revision metadata.
  expect(bridge.received.filter((m) => m.method === "tools/list")).toHaveLength(1);
  expect((await bridge.request(3, "tools/list")).result.tools[0].name).toBe("epoch-1:1");
  bridge.restart();
  await bridge.next((m) => m.method === "notifications/tools/list_changed");
  expect(bridge.received.filter((m) => m.method === "initialize")).toHaveLength(2);
  expect((await bridge.request(4, "tools/list")).result.tools[0].name).toBe("epoch-2:0");
  expect(bridge.received.every((m) => m.registration === bridge.id)).toBe(true);
  // A client can read tools before the next revision poll notices an app restart.
  bridge.restart();
  expect((await bridge.request(5, "tools/list")).result.tools[0].name).toBe("epoch-3:0");
  expect(bridge.received.filter((m) => m.method === "initialize")).toHaveLength(3);
}, 20000);

it("an offline client discovers plugins when Cairngorm becomes available, without special CLI code", async () => {
  const bridge = await setup(true);
  const init = await bridge.request(1, "initialize", {
    clientInfo: { name: "Another MCP CLI", version: "1" },
  });
  expect(init.result.serverInfo.name).toBe("cairngorm");
  expect(init.result.capabilities.resources).toEqual({});
  const offlineResources = (await bridge.request(4, "resources/list")).result.resources;
  expect(offlineResources).toHaveLength(1);
  expect(offlineResources[0].uri).toBe("cairngorm://plugins");
  const unavailable = await bridge.request(5, "resources/read", { uri: offlineResources[0].uri });
  expect(unavailable.error.message).toContain("Cairngorm is not running");
  expect((await bridge.request(2, "tools/list")).result.tools).toEqual([]);
  bridge.discover();
  await bridge.next((m) => m.method === "notifications/tools/list_changed");
  expect((await bridge.request(3, "tools/list")).result.tools[0].name).toBe("epoch-1:0");
  expect((await bridge.request(6, "resources/list")).result.resources).toEqual(offlineResources);
}, 15000);

it("does not truncate native catalog operations that take longer than fifteen seconds", async () => {
  const bridge = await setup(false, 16000);
  await bridge.request(1, "initialize", { clientInfo: { name: "Patient MCP CLI", version: "1" } });
  const response = await bridge.request(2, "tools/list");
  expect(response.error).toBeUndefined();
  expect(response.result.tools[0].name).toBe("epoch-1:0");
}, 25000);
