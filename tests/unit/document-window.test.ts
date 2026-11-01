import { beforeEach, expect, it, vi } from "vitest";

const windows = vi.hoisted(() => ({ open: vi.fn(async () => "detached-doc-7") }));
const events = vi.hoisted(() => ({ emitTo: vi.fn(async () => undefined), listen: vi.fn() }));
const native = vi.hoisted(() => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/documents/data/document-window", async (load) => ({
  ...(await load<typeof import("@/documents/data/document-window")>()),
  openDocumentWindow: windows.open,
}));
vi.mock("@tauri-apps/api/event", () => events);
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: async () => null },
}));
vi.mock("@/terminal/data/terminal-debug-logger", () => ({ debugLog: vi.fn() }));

let store: typeof import("@/terminal/state/terminal-store");
let files: typeof import("@/terminal/state/file-actions");
let moves: typeof import("@/terminal/state/document-window-actions");

beforeEach(async () => {
  vi.resetModules();
  windows.open.mockClear();
  events.emitTo.mockClear();
  native.invoke.mockClear();
  store = await import("@/terminal/state/terminal-store");
  files = await import("@/terminal/state/file-actions");
  moves = await import("@/terminal/state/document-window-actions");
});

const openDocument = (patch: Record<string, unknown> = {}) =>
  files.openFileTab({
    title: "Plan.sample",
    path: ["Plan.sample"],
    fullPath: "C:/Project/Plan.sample",
    extension: "sample",
    document: true,
    ticket: "t1",
    ...patch,
  });

it("moves a document into its own window and brings it back with its provider choice", async () => {
  const id = openDocument();
  expect(await moves.detachDocumentTab(id)).toBe(true);
  expect(windows.open).toHaveBeenCalledWith(
    expect.objectContaining({ tabId: id, path: "C:/Project/Plan.sample", ticket: "t1" }),
  );
  expect(store.getTerminalTab(id)).toMatchObject({
    detached: true,
    detachedWindowLabel: "detached-doc-7",
  });
  expect(store.currentState.layout?.cells.some((c) => c.tabId === id) ?? false).toBe(false);
  moves.reattachDocumentTab(id, "com.example.other");
  expect(store.getTerminalTab(id)).toMatchObject({
    detached: false,
    document: { providerId: "com.example.other" },
  });
  expect(store.currentState.activeTabId).toBe(id);
});

it("never moves unsaved, dropped or text tabs", async () => {
  const dirty = openDocument();
  files.setFileDirty(dirty, true);
  const dropped = files.openFileTab({
    title: "d.sample",
    path: ["d.sample"],
    extension: "sample",
    document: true,
    binarySrc: "data:,",
  });
  const text = files.openFileTab({
    title: "a.ts",
    path: ["a.ts"],
    fullPath: "C:/a.ts",
    content: "x",
    extension: "ts",
  });
  for (const id of [dirty, dropped, text]) {
    expect(await moves.detachDocumentTab(id)).toBe(false);
  }
  expect(windows.open).not.toHaveBeenCalled();
});

it("forwards agent operations to the window showing the document", async () => {
  const { runAgentOperation } = await import("@/app/hooks/use-agent-document-open");
  const id = openDocument();
  await moves.detachDocumentTab(id);
  const tabs = { state: store.currentState } as any;
  const request = {
    id: "op1",
    project: "g1",
    path: String.raw`c:\project\plan.sample`,
    operation: "set-field",
    arguments: {},
    save: false,
  };
  moves.markDocumentWindowReady("detached-doc-7");
  await runAgentOperation(tabs, request);
  expect(events.emitTo).toHaveBeenCalledWith(
    "detached-doc-7",
    "document-window-operation",
    request,
  );
  expect(native.invoke).not.toHaveBeenCalled();
});

it("accepts only complete window payloads", async () => {
  const { documentWindowPayload } = await import("@/documents/data/document-window");
  const at = (value: unknown) => {
    window.history.replaceState(
      null,
      "",
      `/?document=${encodeURIComponent(JSON.stringify(value))}`,
    );
    return documentWindowPayload();
  };
  expect(
    at({ tabId: "7", title: "Plan", path: "C:/p", scope: "g1", extension: "sample" }),
  ).toMatchObject({ tabId: "7" });
  expect(at({ tabId: "7", title: "Plan", scope: "g1" })).toBeNull();
  window.history.replaceState(null, "", "/?document=%7Bbroken");
  expect(documentWindowPayload()).toBeNull();
  window.history.replaceState(null, "", "/");
});

it("asks before closing Cairngorm over unsaved document windows", async () => {
  const { confirmWindowClose, answerCloseConfirmation, getCloseConfirmation } =
    await import("@/terminal/data/close-confirmation");
  const id = openDocument();
  await moves.detachDocumentTab(id);
  files.setFileDirty(id, true);
  const closing = confirmWindowClose(store.currentState.tabs, false);
  expect(getCloseConfirmation()?.confirmLabel).toBe("Close and discard");
  answerCloseConfirmation(false);
  expect(await closing).toBe(false);
});

it("refuses a second window for a file shown twice, and never reattaches terminals", async () => {
  const first = openDocument({ groupId: "g1" });
  // A text tab with unsaved edits plus the agent's document tab of the same file.
  store.setState((prev) => ({
    ...prev,
    tabs: [
      ...prev.tabs,
      {
        id: "t8",
        title: "Plan.sample",
        profile: "file",
        kind: "file",
        status: "idle",
        sessionId: "file-t8",
        detached: false,
        fullPath: "c:/project/plan.sample",
        content: "draft",
        isDirty: true,
        groupId: "g1",
      },
    ],
  }));
  expect(await moves.detachDocumentTab(first)).toBe(false);
  store.setState((prev) => ({
    ...prev,
    tabs: [
      ...prev.tabs,
      {
        id: "t9",
        title: "pwsh",
        profile: "x",
        status: "running",
        sessionId: "s9",
        detached: true,
        detachedWindowLabel: "detached-9",
      },
    ],
  }));
  moves.reattachDocumentTab("t9");
  expect(store.getTerminalTab("t9")?.detached).toBe(true);
});

it("brings a tab back when its window disappeared", async () => {
  const id = openDocument();
  await moves.detachDocumentTab(id);
  await moves.focusDocumentWindowOrRecover("detached-doc-7");
  expect(store.getTerminalTab(id)?.detached).toBe(false);
});

it("answers at once when the target window is not ready yet", async () => {
  const { runAgentOperation } = await import("@/app/hooks/use-agent-document-open");
  const id = openDocument();
  await moves.detachDocumentTab(id);
  const request = {
    id: "op2",
    project: "g1",
    path: "C:/Project/Plan.sample",
    operation: "x",
    arguments: {},
    save: false,
  };
  await runAgentOperation({ state: store.currentState } as any, request);
  expect(events.emitTo).not.toHaveBeenCalled();
  expect(native.invoke).toHaveBeenCalledWith(
    "document_request_complete",
    expect.objectContaining({ id: "op2", error: expect.stringContaining("still opening") }),
  );
});
