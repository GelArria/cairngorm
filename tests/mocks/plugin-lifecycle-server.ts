import { createServer } from "node:http";
import { readFileSync } from "node:fs";

type Snapshot = {
  checkpointId: string;
  shapes: { id: string; type: string; text: string }[];
  assets: unknown[];
  bindings: unknown[];
};
const initial = (): Snapshot => ({
  checkpointId: "initial",
  shapes: [{ id: "shape:one", type: "geo", text: "Initial label" }],
  assets: [],
  bindings: [],
});

/** Deterministic upstream/IPC fixture; no real gateway, credentials or provider is contacted. */
export async function canvasFixture() {
  const calls = new Map<string, { terminal: string; canvas: string }>();
  const saved = new Map<string, Snapshot>();
  const prepared = new Map<string, Snapshot>();
  const stats = { callbacks: 0, saves: 0, refreshes: 0 };
  const behavior = { saveError: false, refreshError: false, teardownError: false };
  const html = readFileSync(new URL("./plugin-lifecycle.html", import.meta.url), "utf8");
  const key = (id: string) => {
    const call = calls.get(id);
    if (!call) throw Error("Unknown fixture call");
    return `${call.terminal}:${call.canvas}`;
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") {
      res.end();
      return;
    }
    try {
      if (req.url === "/behavior") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(behavior));
        return;
      }
      if (req.url === "/stats") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(stats));
        return;
      }
      if (req.url?.startsWith("/view/")) {
        const id = req.url.slice(6);
        const call = calls.get(id)!;
        const snapshot = prepared.get(id) ?? saved.get(key(id)) ?? initial();
        prepared.delete(id);
        const bootstrap = {
          ...snapshot,
          sessionId: `session-${call.terminal}`,
          mcpSessionId: `transport-${call.terminal}`,
          canvasId: call.canvas,
        };
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html.replace("__BOOTSTRAP__", JSON.stringify(bootstrap).replace(/</g, "\\u003c")));
        return;
      }
      if (req.url !== "/command" || req.method !== "POST") {
        res.statusCode = 404;
        res.end();
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1_000_000) throw Error("Fixture request too large");
      }
      const { cmd, args } = JSON.parse(body);
      const id = args.callId;
      const scope = key(id);
      let result: unknown = {};
      if (cmd === "plugin_view_event") result = { emptyCanvasWithoutCheckpoint: false };
      else if (cmd === "plugin_prepare_reload") {
        stats.refreshes++;
        if (behavior.refreshError) throw Error("Fixture resource refresh failed");
        const snapshot = saved.get(scope);
        if (!snapshot) throw Error("No acknowledged checkpoint");
        prepared.set(id, structuredClone(snapshot));
      } else if (cmd === "plugin_view_request") {
        const tool = args.params?.name;
        if (args.method !== "tools/call") throw Error("Unsupported fixture method");
        if (tool === "_exec_callback") stats.callbacks++;
        else if (tool === "save_checkpoint") {
          if (behavior.saveError)
            result = {
              isError: true,
              content: [{ type: "text", text: "Fixture checkpoint save failed" }],
            };
          else {
            const p = args.params.arguments;
            if (p.canvasId !== calls.get(id)!.canvas) throw Error("Cross-canvas save");
            saved.set(scope, {
              checkpointId: p.checkpointId,
              shapes: JSON.parse(p.shapesJson),
              assets: [],
              bindings: [],
            });
            stats.saves++;
          }
        } else throw Error("Tool is not available to views");
      } else throw Error("Unknown fixture command");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Fixture did not listen");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    stats,
    behavior,
    register(id: string, terminal: string, canvas: string) {
      calls.set(id, { terminal, canvas });
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
