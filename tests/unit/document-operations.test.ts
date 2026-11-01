import { afterEach, expect, it, vi } from "vitest";
import {
  registerOpenDocument,
  runDocumentOperation,
  samePath,
} from "@/documents/data/open-documents";
import type { DocumentProviderInfo, LiveDocumentView } from "@/documents/model/provider";
import { ViewNotReadyError } from "@/documents/data/document-view-host";

const provider: DocumentProviderInfo = {
  id: "dev.cairngorm.sample-viewer",
  name: "Sample viewer",
  version: "1.0.0",
  fileTypes: [{ label: "Sample", extensions: ["sample"], mimeTypes: [] }],
  capabilities: ["view", "edit"],
  maxBytes: 1024,
  operations: [{ name: "set-field", description: "x", inputSchema: { type: "object" } }],
  source: "installed",
};
const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach((stop) => stop()));

function open(
  patch: { dirty?: boolean; view?: LiveDocumentView | null; save?: () => Promise<boolean> } = {},
) {
  const view: LiveDocumentView = patch.view ?? {
    requestSave: vi.fn(),
    saved: vi.fn(),
    operate: vi.fn(async (_name, args) => args),
  };
  const save = patch.save ?? vi.fn(async () => true);
  stops.push(
    registerOpenDocument({
      paneId: "pane-1",
      scope: "project-b",
      path: "C:/Project B/Plan.sample",
      provider,
      view: () => view,
      dirty: () => patch.dirty ?? false,
      canSave: () => true,
      save,
      confirmSave: async () => true,
    }),
  );
  return { view, save };
}
const request = (patch = {}) => ({
  project: "project-b",
  path: String.raw`c:\project b\plan.sample`,
  operation: "set-field",
  arguments: { key: "Status", value: "Approved" },
  save: false,
  ...patch,
});

it("matches Windows paths regardless of separators and case", () => {
  expect(samePath(String.raw`C:\A\b.sample`, "c:/a/B.SAMPLE")).toBe(true);
  expect(samePath("/home/a/B.sample", "/home/a/b.sample")).toBe(false);
});

it("runs in the pane of the caller's project and saves when asked", async () => {
  const { save } = open();
  expect(await runDocumentOperation(request({ save: true }))).toEqual({
    result: { key: "Status", value: "Approved" },
    saved: true,
  });
  expect(save).toHaveBeenCalledTimes(1);
  await expect(runDocumentOperation(request({ project: "project-a" }))).rejects.toThrow("not open");
});

it("never saves the user's own unsaved edits", async () => {
  const { view } = open({ dirty: true });
  await expect(runDocumentOperation(request({ save: true }))).rejects.toThrow("unsaved changes");
  expect(view.operate).not.toHaveBeenCalled();
  expect(await runDocumentOperation(request())).toMatchObject({ saved: false });
});

it("waits for a view that is still loading and reports a failed save", async () => {
  let calls = 0;
  const view: LiveDocumentView = {
    requestSave: vi.fn(),
    saved: vi.fn(),
    operate: vi.fn(async () => {
      if (++calls < 3) {
        throw new ViewNotReadyError();
      }
      return "done";
    }),
  };
  open({ view, save: async () => false });
  expect(await runDocumentOperation(request())).toEqual({ result: "done", saved: false });
  await expect(runDocumentOperation(request({ save: true }))).rejects.toThrow("saving failed");
});
