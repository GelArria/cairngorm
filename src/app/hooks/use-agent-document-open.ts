// Agents open files through the MCP file tool: native authorizes the path, keeps the snapshot
// as an immutable ticket and asks the main window to show it. The tab joins the source
// terminal's own project (never whichever project is active), then native is told the outcome.
import { errorMessage } from "@/common/errors";
import { isImageExtension } from "@/common/filesystem/file-kinds";
import {
  answerAgentOperation,
  DOCUMENT_REATTACH,
  DOCUMENT_WINDOW_DIRTY,
  DOCUMENT_WINDOW_OPERATION,
  DOCUMENT_WINDOW_READY,
  DOCUMENT_WINDOW_PREFIX,
  hasDocumentProvider,
  operationsForExtension,
  readAgentSnapshot,
  samePath,
  type OperationRequest,
} from "@/documents/api";
import {
  isDocumentWindowReady,
  markDocumentWindowReady,
  reattachDocumentTab,
  setFileDirty,
} from "@/terminal/workspace";
import type { useTerminalTabs } from "@/terminal/workspace";
import { getExtension } from "@/workspace/model/file-contents";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "preact/hooks";

export interface AgentOpenRequest {
  ticket: string;
  project: string;
  terminal: string;
  path: string;
  name: string;
  size: number;
  sha256: string;
}

type Tabs = ReturnType<typeof useTerminalTabs>;

const IMAGE_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  jpg: "image/jpeg",
  ico: "image/x-icon",
};

function imageUrl(bytes: Uint8Array, extension: string) {
  const type = IMAGE_TYPES[extension] ?? `image/${extension}`;
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes.slice()], { type }));
  });
}

export async function openAgentDocument(tabs: Tabs, request: AgentOpenRequest) {
  const ack = (outcome: { openedIn?: string; operations?: unknown; error?: string }) =>
    invoke("document_ticket_ack", { ticket: request.ticket, ...outcome }).catch((error) =>
      console.warn("[documents] Could not acknowledge an agent open", errorMessage(error)),
    );
  try {
    if (!tabs.state.groups.some((group) => group.id === request.project)) {
      await ack({ error: "The source terminal's project is no longer open in Cairngorm." });
      return;
    }
    const extension = getExtension(request.name);
    const base = {
      title: request.name,
      path: [request.name],
      fullPath: request.path,
      extension,
      groupId: request.project,
    };
    if (await hasDocumentProvider(extension)) {
      tabs.openFileTab({ ...base, content: "", document: true, ticket: request.ticket });
      await ack({ openedIn: "document", operations: await operationsForExtension(extension) });
      return;
    }
    const bytes = await readAgentSnapshot(request.ticket);
    if (!bytes) {
      throw new Error("The authorized snapshot is no longer available.");
    }
    if (isImageExtension(extension)) {
      tabs.openFileTab({ ...base, content: "", imageSrc: await imageUrl(bytes, extension) });
      await ack({ openedIn: "editor" });
      return;
    }
    let text: string | null = null;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = null;
    }
    // Binary formats without a provider show the pane's explicit no-provider state.
    tabs.openFileTab(
      text === null
        ? { ...base, content: "", document: true, ticket: request.ticket }
        : { ...base, content: text },
    );
    await ack({ openedIn: text === null ? "document" : "editor" });
  } catch (error) {
    await ack({ error: errorMessage(error) });
  }
}

/**
 * Runs an agent's operation in the document pane of its own project and reports back. A
 * document moved to its own window answers there: the request is forwarded to that window.
 */
export async function runAgentOperation(tabs: Tabs, request: OperationRequest & { id: string }) {
  const moved = tabs.state.tabs.find(
    (tab) =>
      tab.kind === "file" &&
      tab.detached &&
      tab.detachedWindowLabel?.startsWith(DOCUMENT_WINDOW_PREFIX) &&
      (tab.groupId ?? "g1") === request.project &&
      !!tab.fullPath &&
      samePath(tab.fullPath, request.path),
  );
  const complete = (outcome: { id: string; result?: unknown; error?: string }) =>
    invoke("document_request_complete", outcome).catch((error) =>
      console.warn("[documents] Could not report an agent operation", errorMessage(error)),
    );
  if (moved?.detachedWindowLabel) {
    // A window still loading (or gone) cannot answer; say so now rather than time out.
    if (!isDocumentWindowReady(moved.detachedWindowLabel)) {
      await complete({
        id: request.id,
        error: "The document's window is still opening. Try the operation again in a moment.",
      });
      return;
    }
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo(moved.detachedWindowLabel, DOCUMENT_WINDOW_OPERATION, request);
    return;
  }
  await answerAgentOperation(request, complete);
}

/** Main window only: native addresses these requests to it. */
export function useAgentDocumentOpen(tabs: Tabs) {
  const latest = useRef(tabs);
  latest.current = tabs;
  useEffect(() => {
    let alive = true;
    const stops: (() => void)[] = [];
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        Promise.all([
          listen<AgentOpenRequest>("document-open-request", ({ payload }) => {
            void openAgentDocument(latest.current, payload);
          }),
          listen<OperationRequest & { id: string }>("document-operation-request", ({ payload }) => {
            void runAgentOperation(latest.current, payload);
          }),
          listen<{ tabId: string; providerId?: string }>(DOCUMENT_REATTACH, ({ payload }) => {
            reattachDocumentTab(payload.tabId, payload.providerId);
          }),
          listen<{ label: string }>(DOCUMENT_WINDOW_READY, ({ payload }) => {
            markDocumentWindowReady(payload.label);
          }),
          listen<{ tabId: string; dirty: boolean }>(DOCUMENT_WINDOW_DIRTY, ({ payload }) => {
            const tab = latest.current.state.tabs.find((t) => t.id === payload.tabId);
            if (tab?.detached && tab.detachedWindowLabel?.startsWith(DOCUMENT_WINDOW_PREFIX)) {
              setFileDirty(payload.tabId, payload.dirty === true);
            }
          }),
        ]),
      )
      .then((unlisteners) => {
        for (const unlisten of unlisteners) {
          if (alive) {
            stops.push(unlisten);
          } else {
            unlisten();
          }
        }
      })
      .catch(() => {
        /* outside Tauri no agent can open documents */
      });
    return () => {
      alive = false;
      stops.forEach((stop) => stop());
    };
  }, []);
}
