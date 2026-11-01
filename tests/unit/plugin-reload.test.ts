import { afterEach, beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
import { ViewHost } from "@/plugins/data/view-host";
import type { PluginCall } from "@/plugins/model/types";

const origin = "http://127.0.0.1:4567";
const call: PluginCall = {
  id: "reload-call",
  plugin: "tldraw",
  pluginName: "tldraw",
  terminal: "terminal",
  tool: { name: "exec" },
  arguments: { canvasId: "canvas-A" },
  viewUrl: origin + "/view/call",
  view: null,
};
let frame: HTMLIFrameElement;
let host: ViewHost;
let posted: any[];
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const fromView = (data: unknown, overrideOrigin = origin) =>
  window.dispatchEvent(
    new MessageEvent("message", { source: frame.contentWindow, origin: overrideOrigin, data }),
  );
const save = (id = 1, canvas = "canvas-A") =>
  fromView({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "save_checkpoint",
      arguments: { canvasId: canvas, checkpointId: "new", shapesJson: "[]" },
    },
  });
function ready(result: unknown = { structuredContent: { canvasId: "canvas-A" } }) {
  fromView({
    jsonrpc: "2.0",
    id: "initialize",
    method: "ui/initialize",
    params: { appCapabilities: { availableDisplayModes: ["fullscreen", "inline"] } },
  });
  host.finish(result);
  fromView({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
}
async function acknowledgeTeardown() {
  await tick();
  const request = posted.find((m) => m.method === "ui/resource-teardown");
  expect(request).toBeDefined();
  fromView({ jsonrpc: "2.0", id: request.id, result: {} });
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockResolvedValue({});
  frame = document.createElement("iframe");
  document.body.append(frame);
  posted = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((m) => posted.push(m));
  host = new ViewHost({
    call,
    frame,
    deliverInput: true,
    hostContext: () => ({ containerDimensions: { width: 800, height: 600 } }),
  });
});
afterEach(() => {
  host.dispose();
  frame.remove();
  vi.useRealTimers();
});

it("rejects reload while the opening call is working", async () => {
  fromView({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
  await expect(host.prepareReload()).rejects.toThrow("still working");
  expect(invoke.mock.calls.some(([cmd]) => cmd === "plugin_prepare_reload")).toBe(false);
});

it("requires a fresh same-canvas save then a correlated teardown acknowledgement", async () => {
  ready();
  const reload = host.prepareReload();
  expect(frame.hasAttribute("inert")).toBe(true);
  await tick();
  const inline = posted.find(
    (m) =>
      m.method === "ui/notifications/host-context-changed" && m.params.displayMode === "inline",
  );
  expect(inline.params.containerDimensions).toEqual({ width: 800, height: 600 });
  save(1, "canvas-B");
  await tick();
  expect(invoke.mock.calls.some(([cmd]) => cmd === "plugin_prepare_reload")).toBe(false);
  save(2);
  await tick();
  expect(invoke).toHaveBeenCalledWith("plugin_prepare_reload", { callId: "reload-call" });
  const teardown = posted.find((m) => m.method === "ui/resource-teardown");
  fromView({ jsonrpc: "2.0", id: "wrong-id", result: {} });
  fromView({ jsonrpc: "2.0", id: teardown.id, result: {} }, "https://foreign.example");
  let settled = false;
  void reload.then(() => {
    settled = true;
  });
  await tick();
  expect(settled).toBe(false);
  fromView({ jsonrpc: "2.0", id: teardown.id, result: {} });
  await reload;
  expect(frame.hasAttribute("inert")).toBe(false);
  host.dispose();
  expect(posted.filter((m) => m.method === "ui/resource-teardown")).toHaveLength(1);
});

it("drains in-flight requests but does not count an older save as a fresh flush", async () => {
  let oldResolve!: (value: unknown) => void;
  invoke.mockImplementation((cmd, args) =>
    cmd === "plugin_view_request" && args.params.arguments?.checkpointId === "old"
      ? new Promise((resolve) => {
          oldResolve = resolve;
        })
      : Promise.resolve({}),
  );
  ready();
  fromView({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "save_checkpoint", arguments: { canvasId: "canvas-A", checkpointId: "old" } },
  });
  const reload = host.prepareReload();
  oldResolve({});
  await tick();
  expect(invoke.mock.calls.some(([cmd]) => cmd === "plugin_prepare_reload")).toBe(false);
  save(2);
  await acknowledgeTeardown();
  await reload;
});

it("keeps the view and restores input when native refresh fails", async () => {
  invoke.mockImplementation((cmd) =>
    cmd === "plugin_prepare_reload"
      ? Promise.reject(Error("resource unavailable"))
      : Promise.resolve({}),
  );
  ready();
  const reload = host.prepareReload();
  const assertion = expect(reload).rejects.toThrow("resource unavailable");
  await tick();
  save();
  await assertion;
  expect(frame.isConnected).toBe(true);
  expect(frame.hasAttribute("inert")).toBe(false);
  expect(posted.some((m) => m.method === "ui/resource-teardown")).toBe(false);
});

it("a failed save or absent flush never authorizes replacement", async () => {
  invoke.mockImplementation((cmd) =>
    Promise.resolve(cmd === "plugin_view_request" ? { isError: true } : {}),
  );
  ready();
  const failed = host.prepareReload();
  const assertion = expect(failed).rejects.toThrow("could not be saved");
  await tick();
  save();
  await assertion;
  invoke.mockResolvedValue({});
  const missing = host.prepareReload();
  const timeout = expect(missing).rejects.toThrow("five seconds");
  await vi.advanceTimersByTimeAsync(5000);
  await timeout;
  expect(invoke.mock.calls.some(([cmd]) => cmd === "plugin_prepare_reload")).toBe(false);
  expect(frame.hasAttribute("inert")).toBe(false);
});

it("only native-confirmed empty canvases can use the empty flush contingency", async () => {
  invoke.mockImplementation((cmd, args) =>
    Promise.resolve(
      cmd === "plugin_view_event" && args.event === "context"
        ? { emptyCanvasWithoutCheckpoint: true }
        : {},
    ),
  );
  ready();
  const reload = host.prepareReload();
  await tick();
  fromView({
    jsonrpc: "2.0",
    id: 1,
    method: "ui/update-model-context",
    params: { structuredContent: { shapes: [] } },
  });
  await acknowledgeTeardown();
  await reload;
});

it("recovery skips the disposed editor but still requires native preparation and teardown", async () => {
  ready({ isError: true });
  const reload = host.prepareReload();
  await acknowledgeTeardown();
  await reload;
  expect(invoke).toHaveBeenCalledWith("plugin_prepare_reload", { callId: "reload-call" });
  expect(
    posted.some(
      (m) =>
        m.method === "ui/notifications/host-context-changed" && m.params.displayMode === "inline",
    ),
  ).toBe(false);
});

it("disposal rejects an outstanding flush without preparing another iframe", async () => {
  ready();
  const reload = host.prepareReload();
  const assertion = expect(reload).rejects.toThrow("closed");
  host.dispose();
  await assertion;
  expect(invoke.mock.calls.some(([cmd]) => cmd === "plugin_prepare_reload")).toBe(false);
});

it("a remounted recovered editor flushes new edits, using its native canvas identity", async () => {
  host.dispose();
  invoke.mockImplementation((cmd) =>
    Promise.resolve(cmd === "plugin_view_event" ? { canvasId: "canvas-A" } : {}),
  );
  host = new ViewHost({
    call: { ...call, arguments: {} },
    frame,
    deliverInput: false,
    hostContext: () => ({ containerDimensions: { width: 800, height: 600 } }),
  });
  ready({ isError: true });
  const reload = host.prepareReload();
  await tick();
  expect(invoke.mock.calls.some(([cmd]) => cmd === "plugin_prepare_reload")).toBe(false);
  save();
  await acknowledgeTeardown();
  await reload;
});

it("a late native refresh cannot tear down the kept iframe after the deadline", async () => {
  let resolve!: (value: unknown) => void;
  invoke.mockImplementation((cmd) =>
    cmd === "plugin_prepare_reload"
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve({}),
  );
  ready();
  const reload = host.prepareReload();
  const assertion = expect(reload).rejects.toThrow("five seconds");
  await tick();
  save();
  await tick();
  expect(invoke).toHaveBeenCalledWith("plugin_prepare_reload", { callId: "reload-call" });
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
  resolve({});
  await tick();
  expect(posted.some((m) => m.method === "ui/resource-teardown")).toBe(false);
  expect(frame.isConnected).toBe(true);
});
