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

it("overlays acknowledged data while preserving all fresh transport fields", () => {
  const bootstrap = {
    canvasId: "canvas-A",
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
});

it("rejects a different canvas rather than changing transport identity", () => {
  (window as any).__TLDRAW_BOOTSTRAP__ = { canvasId: "canvas-B" };
  const script = document.createElement("script");
  script.dataset.cairngormCanvas = btoa(JSON.stringify({ ...data, shapes: [] }));
  vi.spyOn(document, "currentScript", "get").mockReturnValue(script);
  expect(() => new Function(restore)()).toThrow("does not match");
  expect((window as any).__TLDRAW_BOOTSTRAP__).toEqual({ canvasId: "canvas-B" });
});
