import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open }));

import { ViewHost } from "@/plugins/data/view-host";
import type { PluginCall } from "@/plugins/model/types";

const ORIGIN = "http://127.0.0.1:4567";
const call: PluginCall = {
  id: "call-1",
  plugin: "tldraw",
  pluginName: "tldraw",
  terminal: "term-1",
  tool: { name: "exec" },
  arguments: { code: "return 1" },
  viewUrl: `${ORIGIN}/view/call-1`,
  view: {
    csp: { connectDomains: ["https://cdn.example.com"] },
    permissions: { clipboardWrite: {} },
  },
};

let frame: HTMLIFrameElement;
let posted: unknown[];
let host: ViewHost;

function fromView(data: unknown, options: { origin?: string; source?: Window | null } = {}) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: options.origin ?? ORIGIN,
      source: options.source === undefined ? frame.contentWindow : options.source,
    }),
  );
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ ok: true });
  open.mockReset();
  frame = document.createElement("iframe");
  document.body.append(frame);
  posted = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message);
  });
  host = new ViewHost({ call, frame, hostContext: () => ({ theme: "dark" }), deliverInput: true });
});

afterEach(() => {
  host.dispose();
  frame.remove();
});

const events = () =>
  invoke.mock.calls.filter(([cmd]) => cmd === "plugin_view_event").map(([, args]) => args.event);

describe("ViewHost", () => {
  it("does not replay input and reports every mount independently", async () => {
    host.dispose();
    await flush();
    invoke.mockClear();
    posted.length = 0;
    host = new ViewHost({ call, frame, hostContext: () => ({}), deliverInput: false });
    host.finish({ content: [] });
    fromView({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await flush();
    const methods = posted.map((m: any) => m.method);
    expect(methods).not.toContain("ui/notifications/tool-input");
    expect(methods).not.toContain("ui/notifications/tool-result");
    host.dispose();
    await flush();
    expect(events()).toEqual(["opened", "closed"]);
  });

  it("answers ui/initialize and sends the tool input once initialized", async () => {
    fromView({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: { protocolVersion: "2026-01-26" },
    });
    await flush();
    const reply = posted[0] as any;
    expect(reply.id).toBe(1);
    expect(reply.result.hostContext.theme).toBe("dark");
    expect(reply.result.hostCapabilities.sandbox.csp.connectDomains).toEqual([
      "https://cdn.example.com",
    ]);
    expect(posted).toHaveLength(1);

    fromView({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await flush();
    expect(posted[1]).toEqual({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: { code: "return 1" } },
    });
    expect(posted[2]).toMatchObject({
      method: "ui/notifications/host-context-changed",
      params: { displayMode: "fullscreen" },
    });
  });

  it("reports context only after the input, in order", async () => {
    fromView({ jsonrpc: "2.0", id: 1, method: "ui/update-model-context", params: { content: [] } });
    fromView({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    fromView({
      jsonrpc: "2.0",
      id: 2,
      method: "ui/update-model-context",
      params: { content: [{ type: "text", text: "done" }] },
    });
    await flush();
    await flush();
    expect(events()).toEqual(["opened", "context", "input", "context"]);
  });

  it("ignores messages from other frames and origins", async () => {
    fromView(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "x" } },
      { origin: "https://evil.example" },
    );
    fromView(
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "x" } },
      { source: window },
    );
    await flush();
    expect(posted).toHaveLength(0);
    expect(invoke.mock.calls.some(([cmd]) => cmd === "plugin_view_request")).toBe(false);
  });

  it("forwards a view's fallback context menu to its owning pane", () => {
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 50, 400, 300));
    const menu = vi.fn();
    const blur = vi.spyOn(frame, "blur");
    document.body.addEventListener("contextmenu", menu);
    try {
      const message = {
        jsonrpc: "2.0",
        method: "cairngorm/context-menu",
        params: { x: 20, y: 30 },
      };
      fromView(message, { origin: "https://foreign.example" });
      fromView(message, { source: window });
      fromView({ ...message, params: { x: "20", y: 30 } });
      fromView({ ...message, params: { x: 500, y: 30 } });
      expect(menu).not.toHaveBeenCalled();
      fromView(message);
      expect(menu).toHaveBeenCalledTimes(1);
      expect(menu.mock.calls[0][0]).toMatchObject({
        clientX: 120,
        clientY: 80,
        bubbles: true,
        cancelable: true,
      });
      expect(blur).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener("contextmenu", menu);
    }
  });

  it("proxies server requests and rejects unsupported ones", async () => {
    fromView({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "_exec_callback", arguments: {} },
    });
    fromView({ jsonrpc: "2.0", id: 4, method: "ui/message", params: {} });
    fromView({
      jsonrpc: "2.0",
      id: 5,
      method: "ui/open-link",
      params: { url: "file:///etc/passwd" },
    });
    await flush();
    await flush();
    expect(invoke).toHaveBeenCalledWith("plugin_view_request", {
      callId: "call-1",
      method: "tools/call",
      params: { name: "_exec_callback", arguments: {} },
    });
    const byId = (id: number) => posted.find((m: any) => m.id === id) as any;
    expect(byId(3).result).toEqual({ ok: true });
    expect(byId(4).error.message).toMatch(/not supported/);
    expect(byId(5).error).toBeDefined();
    expect(open).not.toHaveBeenCalled();
  });

  it("delivers the result after initialization, or a cancellation on failure", async () => {
    host.finish({ content: [{ type: "text", text: "ok" }] });
    expect(posted).toHaveLength(0);
    fromView({ jsonrpc: "2.0", method: "ui/notifications/initialized" });
    await flush();
    expect(posted.map((m: any) => m.method)).toEqual([
      "ui/notifications/tool-input",
      "ui/notifications/host-context-changed",
      "ui/notifications/tool-result",
    ]);
    host.finish(undefined, "server down");
    expect((posted[3] as any).method).toBe("ui/notifications/tool-cancelled");
  });
});
