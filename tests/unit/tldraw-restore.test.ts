import { afterEach, expect, it, vi } from "vitest";
import restore from "@/plugins/assets/tldraw-restore.js?raw";

const data = {
  canvasId: "canvas-A",
  checkpointId: "saved",
  shapes: [{ id: "shape:one", type: "geo", text: "Ω </script>" }],
  assets: [{ id: "asset:one" }],
  bindings: [
    {
      type: "arrow",
      fromId: "shape:arrow",
      toId: "shape:one",
      props: {
        terminal: "start",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
        isExact: false,
      },
      meta: {},
    },
  ],
};
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).__TLDRAW_BOOTSTRAP__;
});

it.each([{}, { canvasId: "canvas-A" }])(
  "overlays acknowledged data on a session-scoped or canvas-scoped resource: %j",
  (identity) => {
    const bootstrap = {
      ...identity,
      sessionId: "fresh",
      mcpSessionId: "fresh-mcp",
      workerOrigin: "https://worker.example",
      methodMap: { "tools/call": "fresh-method" },
      shapes: [],
      arbitraryTransportField: 42,
    };
    (window as any).__TLDRAW_BOOTSTRAP__ = bootstrap;
    const script = document.createElement("script");
    script.dataset.cairngormCanvas = btoa(
      String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data))),
    );
    vi.spyOn(document, "currentScript", "get").mockReturnValue(script);
    new Function(restore)();
    expect((window as any).__TLDRAW_BOOTSTRAP__).toEqual({ ...bootstrap, ...data });
    expect(bootstrap).toMatchObject({
      sessionId: "fresh",
      mcpSessionId: "fresh-mcp",
      workerOrigin: "https://worker.example",
      methodMap: { "tools/call": "fresh-method" },
      arbitraryTransportField: 42,
    });
  },
);

it.each([
  { sessionId: "fresh", canvasId: "canvas-B" },
  { sessionId: "fresh", canvasId: null },
  { sessionId: "fresh", canvasId: "" },
  { sessionId: "fresh", canvasId: 42 },
  { sessionId: "" },
  {},
])("rejects a conflicting canvas or invalid transport: %j", (identity) => {
  (window as any).__TLDRAW_BOOTSTRAP__ = { ...identity };
  const script = document.createElement("script");
  script.dataset.cairngormCanvas = btoa(JSON.stringify({ ...data, shapes: [] }));
  vi.spyOn(document, "currentScript", "get").mockReturnValue(script);
  expect(() => new Function(restore)()).toThrow("does not match");
  expect((window as any).__TLDRAW_BOOTSTRAP__).toEqual(identity);
});
