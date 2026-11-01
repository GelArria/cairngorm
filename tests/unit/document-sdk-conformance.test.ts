// The published SDK against the real host, over a simulated cross-origin postMessage link.
import { afterEach, expect, it, vi } from "vitest";
import { DocumentViewHost } from "@/documents/data/document-view-host";
import type { DocumentSnapshot } from "@/documents/model/provider";
import { createDocumentClient } from "@/documents/sdk/document-sdk";

const APP = "http://tauri.localhost";
const PROVIDER = "http://d-0123456789abcdef0123456789abcdef.localhost:4321";

function message(data: unknown, origin: string, source: unknown) {
  const event = new MessageEvent("message", { data: structuredClone(data), origin });
  Object.defineProperty(event, "source", { value: source });
  return event;
}

function link() {
  const providerEvents = new EventTarget() as unknown as Window;
  const posted: Array<{ message: any; origin: string }> = [];
  const parent = {
    postMessage: (data: unknown) =>
      setTimeout(() => window.dispatchEvent(message(data, PROVIDER, view))),
  };
  const view = {
    postMessage: (data: unknown, origin: string) => {
      posted.push({ message: data, origin });
      setTimeout(() =>
        (providerEvents as unknown as EventTarget).dispatchEvent(message(data, APP, parent)),
      );
    },
  };
  const frame = { contentWindow: view } as unknown as HTMLIFrameElement;
  return { frame, parent, view, providerEvents, posted };
}

let snapshot: DocumentSnapshot = {
  name: "notes.sample",
  extension: "sample",
  mimeType: "text/x-cairngorm-sample",
  bytes: new TextEncoder().encode("# Notes\nkey = value"),
  version: "v1",
};

const hosts: DocumentViewHost[] = [];
function start(overrides: Partial<ConstructorParameters<typeof DocumentViewHost>[0]> = {}) {
  const wire = link();
  const events = { onReady: vi.fn(), onError: vi.fn() };
  const host = new DocumentViewHost({
    frame: wire.frame,
    origin: PROVIDER,
    snapshot: () => snapshot,
    context: () => ({ theme: "dark" }),
    ...events,
    ...overrides,
  });
  hosts.push(host);
  const client = createDocumentClient({
    host: wire.parent,
    events: wire.providerEvents,
    timeoutMs: 500,
  });
  return { ...wire, ...events, host, client };
}

afterEach(() => {
  hosts.splice(0).forEach((host) => host.dispose());
});

it("initializes, reads a copy of the snapshot and reports ready", async () => {
  const { client, onReady, posted } = start();
  const connected = await client.connect();
  expect(connected.document).toMatchObject({
    name: "notes.sample",
    size: snapshot.bytes.byteLength,
    version: "v1",
  });
  expect(connected.capabilities).toEqual({ view: true, edit: false });
  expect(connected.context.theme).toBe("dark");
  const bytes = await connected.read();
  bytes[0] = 0;
  expect(snapshot.bytes[0]).toBe("#".charCodeAt(0));
  expect(await connected.readText()).toBe("# Notes\nkey = value");
  connected.ready();
  await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
  // Document bytes only ever go to the provider's origin.
  expect(posted.every((entry) => entry.origin === PROVIDER)).toBe(true);
});

it("publishes new versions and context changes to the view", async () => {
  const { client, host } = start();
  const connected = await client.connect();
  const changed = vi.fn();
  const context = vi.fn();
  connected.onDocumentChange(changed);
  connected.onContextChange(context);
  snapshot = { ...snapshot, bytes: new TextEncoder().encode("# Updated"), version: "v2" };
  host.documentChanged();
  host.contextChanged({ theme: "light" });
  await vi.waitFor(() =>
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ version: "v2" })),
  );
  await vi.waitFor(() =>
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ theme: "light" })),
  );
  expect(await connected.readText()).toBe("# Updated");
});

it("surfaces provider errors, bounded in length", async () => {
  const { client, onError } = start();
  const connected = await client.connect();
  connected.reportError(new Error("x".repeat(2000)));
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(onError.mock.calls[0][0]).toHaveLength(500);
});

it("ignores other windows, other origins and messages before initialization", async () => {
  const { onReady, onError, view } = start();
  window.dispatchEvent(message({ jsonrpc: "2.0", method: "document/ready" }, PROVIDER, view));
  window.dispatchEvent(
    message(
      { jsonrpc: "2.0", method: "document/error", params: {} },
      "http://evil.localhost",
      view,
    ),
  );
  window.dispatchEvent(
    message({ jsonrpc: "2.0", method: "document/error", params: {} }, PROVIDER, {}),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(onReady).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("rejects unknown methods and protocol versions", async () => {
  const { view, posted } = start();
  window.dispatchEvent(
    message({ jsonrpc: "2.0", id: 7, method: "fs/read", params: { path: "C:/x" } }, PROVIDER, view),
  );
  window.dispatchEvent(message({ jsonrpc: "2.0", id: 8, method: "document/read" }, PROVIDER, view));
  window.dispatchEvent(
    message(
      { jsonrpc: "2.0", id: 9, method: "document/initialize", params: { protocolVersion: "2" } },
      PROVIDER,
      view,
    ),
  );
  expect(posted.map((entry) => [entry.message.id, entry.message.error?.code])).toEqual([
    [7, -32601],
    [8, -32002],
    [9, -32602],
  ]);
});

it("tears down on close and processes nothing afterwards", async () => {
  const { client, host, onError } = start();
  const connected = await client.connect();
  const teardown = vi.fn();
  connected.onTeardown(teardown);
  host.dispose();
  await vi.waitFor(() => expect(teardown).toHaveBeenCalledWith({ reason: "closed" }));
  connected.reportError("late");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(onError).not.toHaveBeenCalled();
  await expect(connected.read()).rejects.toThrow("ended");
});

it("reports a provider that never becomes ready", async () => {
  const { onError } = start({ readyTimeoutMs: 20 });
  await vi.waitFor(() =>
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("did not finish loading")),
  );
});

it("bounds repeated reads of one version", async () => {
  const { client } = start();
  const connected = await client.connect();
  for (let i = 0; i < 8; i++) {
    await connected.read();
  }
  await expect(connected.read()).rejects.toThrow("already read");
});

it("saves through the host: dirty state, provider bytes and a committed version", async () => {
  const onDirty = vi.fn();
  const { client, host, onReady } = start({ canEdit: true, onDirty });
  const connected = await client.connect();
  expect(connected.capabilities.edit).toBe(true);
  connected.onSave(() => "# Edited\nkey = new");
  const changed = vi.fn();
  const saved = vi.fn();
  connected.onDocumentChange(changed);
  connected.onSaved(saved);
  connected.ready();
  await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
  connected.setDirty(true);
  await vi.waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
  const bytes = await host.requestSave();
  expect(new TextDecoder().decode(bytes)).toBe("# Edited\nkey = new");
  snapshot = { ...snapshot, bytes, version: "committed" };
  host.saved(snapshot);
  // The view already has these bytes: committing them is not announced as an outside change.
  host.documentChanged();
  await vi.waitFor(() =>
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ version: "committed" })),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(changed).not.toHaveBeenCalled();
});

it("runs declared operations and reports unknown ones", async () => {
  const { client, host, onReady } = start();
  const connected = await client.connect();
  connected.onOperation("echo", (args) => ({ received: args }));
  connected.ready();
  await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
  expect(await host.operate("echo", { x: 1 })).toEqual({ received: { x: 1 } });
  await expect(host.operate("delete-everything", {})).rejects.toThrow("not available");
});

it("read-only sessions ignore dirty reports and refuse to save", async () => {
  const onDirty = vi.fn();
  const { client, host, onReady } = start({ onDirty });
  const connected = await client.connect();
  expect(connected.capabilities.edit).toBe(false);
  connected.ready();
  await vi.waitFor(() => expect(onReady).toHaveBeenCalled());
  connected.setDirty(true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(onDirty).not.toHaveBeenCalledWith(true);
  await expect(host.requestSave()).rejects.toThrow("cannot be saved");
});
