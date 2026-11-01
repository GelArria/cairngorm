// Document panes currently open, by project and file. Agent operations reach a document only
// through the pane showing it in the caller's own project, using its provider's declared
// operations; nothing here can open files, run code or bypass the pane's save rules.
import type { DocumentProviderInfo, LiveDocumentView } from "../model/provider";
import { ViewNotReadyError } from "./document-view-host";

export interface OpenDocument {
  paneId: string;
  scope: string;
  path?: string;
  provider: DocumentProviderInfo;
  view: () => LiveDocumentView | null;
  dirty: () => boolean;
  canSave: () => boolean;
  save: () => Promise<boolean>;
  /** Asks the user in the pane; resolves `false` when declined or at the deadline. */
  confirmSave: (operation: string, deadline: number) => Promise<boolean>;
}

export interface OperationRequest {
  project: string;
  path: string;
  operation: string;
  arguments: Record<string, unknown>;
  save: boolean;
  /** Milliseconds since epoch after which nothing may be saved (native gave up later). */
  deadline?: number;
}

const open = new Map<string, OpenDocument>();
const READY_WAIT_MS = 10000;
const DEFAULT_BUDGET_MS = 120000;
const POLL_MS = 150;

export function registerOpenDocument(entry: OpenDocument) {
  open.set(entry.paneId, entry);
  return () => {
    if (open.get(entry.paneId) === entry) {
      open.delete(entry.paneId);
    }
  };
}

/** Same file regardless of separator style; Windows paths compare case-insensitively. */
export function samePath(a: string, b: string) {
  const normal = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const windows = /^[a-z]:\//i.test(normal(a)) || normal(a).startsWith("//");
  return windows ? normal(a).toLowerCase() === normal(b).toLowerCase() : normal(a) === normal(b);
}

function panesFor(request: OperationRequest) {
  return [...open.values()].filter(
    (entry) => entry.scope === request.project && entry.path && samePath(entry.path, request.path),
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a declared operation in the document's pane, optionally saving afterwards. */
export async function runDocumentOperation(request: OperationRequest): Promise<unknown> {
  const deadline = request.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const readyBy = Math.min(Date.now() + READY_WAIT_MS, deadline);
  for (;;) {
    const panes = panesFor(request);
    const entry = panes[0];
    if (!entry) {
      throw new Error(
        "This document is not open in the terminal's project. Open it with cairngorm_open_file first.",
      );
    }
    if (!entry.provider.operations?.some((op) => op.name === request.operation)) {
      throw new Error(
        `${entry.provider.name} does not offer the "${request.operation}" operation.`,
      );
    }
    if (request.save && !entry.canSave()) {
      throw new Error(
        "This document cannot be saved by Cairngorm (read-only provider or no file on disk).",
      );
    }
    // Saving would also write unsaved edits, in this pane or another pane of the same file.
    if (request.save && panes.some((pane) => pane.dirty())) {
      throw new Error(
        "The document has unsaved changes in Cairngorm; run without save or ask the user to save first.",
      );
    }
    try {
      const view = entry.view();
      if (!view) {
        throw new ViewNotReadyError();
      }
      const value = await view.operate(request.operation, request.arguments);
      if (!request.save) {
        return { result: value, saved: false };
      }
      if (Date.now() >= deadline) {
        throw new Error("The operation ran but time ran out before saving; nothing was saved.");
      }
      // The user approves every agent save, and sees that it includes all unsaved changes.
      if (!(await entry.confirmSave(request.operation, deadline))) {
        throw new Error(
          "The user did not approve saving; the change is shown unsaved in Cairngorm.",
        );
      }
      if (!(await entry.save())) {
        throw new Error(
          "The operation ran, but saving failed; the change is shown unsaved in Cairngorm.",
        );
      }
      return { result: value, saved: true };
    } catch (error) {
      if (!(error instanceof ViewNotReadyError) || Date.now() > readyBy) {
        throw error;
      }
      await sleep(POLL_MS);
    }
  }
}

/** Runs an agent's operation here and reports the outcome to the waiting MCP tool call. */
export async function answerAgentOperation(
  request: OperationRequest & { id: string },
  complete: (outcome: { id: string; result?: unknown; error?: string }) => Promise<unknown>,
) {
  const { id, ...operation } = request;
  try {
    await complete({ id, result: await runDocumentOperation(operation) });
  } catch (error) {
    await complete({ id, error: error instanceof Error ? error.message : String(error) });
  }
}
