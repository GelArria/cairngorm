import { isImageExtension } from "@/common/filesystem/file-kinds";
import { writeFileContent } from "@/common/filesystem/fs-bridge";
import { hasLoadedDocumentProvider, requestDocumentSave, samePath } from "@/documents/api";
import { debugLog } from "../data/terminal-debug-logger";
import { finalizeLayout } from "../model/layout/finalize";
import { activeInline } from "../model/layout/geometry";
import { normalizeLayout } from "../model/layout/normalize";
import { type TermTab, type TileLayout } from "../model/types";
import { nextIdValue, uid } from "./id-counter";
import { currentState, setState } from "./terminal-store";

export function openFileTab(data: {
  title: string;
  path: string[];
  fullPath?: string;
  content?: string;
  extension?: string;
  imageSrc?: string;
  binarySrc?: string;
  /** Open in a document pane; the provider is resolved from the extension. */
  document?: boolean;
  /** Agent-opened snapshot (see documents tickets); never persisted. */
  ticket?: string;
  /** Project to open in; an inactive project gains the tab without being shown. */
  groupId?: string;
  highlightLine?: number;
  highlightText?: string;
}): string {
  debugLog("tabs", "openFileTab", `title=${data.title}`);
  const group = data.groupId ?? currentState.activeGroupId;
  const visible = group === currentState.activeGroupId;
  const existing = currentState.tabs.find(
    (t) =>
      t.kind === "file" &&
      (!data.groupId || (t.groupId ?? "g1") === data.groupId) &&
      samePath(t.fullPath ?? t.path?.join("/") ?? "", data.fullPath ?? data.path.join("/")) &&
      // An agent document never takes over a text tab, which may hold unsaved edits.
      (!data.document || Boolean(t.document) || (!t.isDirty && !t.content)),
  );
  if (existing) {
    // Re-open: refresh highlight info if any, and just activate
    const hk = data.highlightLine != null ? nextIdValue() : undefined;
    const id = existing.id;
    setState((prev) => ({
      ...prev,
      activeTabId: visible ? id : prev.activeTabId,
      tabs: prev.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              highlightLine: data.highlightLine,
              highlightText: data.highlightText,
              highlightKey: hk,
              // A newer agent snapshot replaces the shown one.
              documentTicket: data.ticket ?? t.documentTicket,
              document: data.document ? (t.document ?? {}) : t.document,
            }
          : t,
      ),
    }));
    return id;
  }
  const id = uid();
  const tab: TermTab = {
    id,
    title: data.title,
    profile: "file",
    kind: "file",
    status: "idle",
    sessionId: `file-${id}`,
    openedAt: Date.now(),
    detached: false,
    isAgent: false,
    path: data.path,
    fullPath: data.fullPath,
    content: data.content ?? "",
    extension: data.extension,
    isImage: data.imageSrc != null || isImageExtension(data.extension ?? ""),
    imageSrc: data.imageSrc,
    highlightLine: data.highlightLine,
    highlightText: data.highlightText,
    binarySrc: data.binarySrc,
    document: data.document ? {} : undefined,
    documentTicket: data.ticket,
    highlightKey: data.highlightLine != null ? nextIdValue() : undefined,
  };
  setState((prev) => {
    const tabs = [...prev.tabs, { ...tab, groupId: group }];
    if (group !== prev.activeGroupId) {
      // Laid out when its project is shown again.
      return { ...prev, tabs };
    }
    return {
      ...prev,
      tabs,
      layout: finalizeLayout(
        normalizeLayout(activeInline(tabs, prev.activeGroupId), prev.layout) as TileLayout,
      ),
      activeTabId: id,
    };
  });
  return id;
}

/**
 * Shown by a document provider (never saved as text). Panes saved before providers existed
 * carry no flag: an untouched tab without text whose type a provider handles is a document.
 */
export function isDocumentTab(tab: TermTab): boolean {
  if (tab.isImage ?? isImageExtension(tab.extension ?? "")) {
    return false;
  }
  return (
    Boolean(tab.document) ||
    (Boolean(tab.fullPath) &&
      !tab.content &&
      !tab.isDirty &&
      hasLoadedDocumentProvider(tab.extension ?? ""))
  );
}

export function updateFileContent(id: string, content: string) {
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((t) => (t.id === id ? { ...t, content, isDirty: true } : t)),
  }));
}

export function markFileClean(id: string) {
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((t) => (t.id === id ? { ...t, isDirty: false } : t)),
  }));
}

export async function saveFileTab(id = currentState.activeTabId) {
  const tab = currentState.tabs.find((t) => t.id === id);
  if (tab?.kind === "file" && isDocumentTab(tab)) {
    // Document panes save through their provider; text is never written over them.
    requestDocumentSave(tab.id);
    return;
  }
  if (
    tab?.kind !== "file" ||
    !tab.fullPath ||
    tab.isImage ||
    isDocumentTab(tab) ||
    // A clean pane has nothing to write; never risk text over a provider-handled file.
    (!tab.isDirty && hasLoadedDocumentProvider(tab.extension ?? "")) ||
    ["diff", "git-graph", "git-commit"].includes(tab.extension ?? "")
  ) {
    return;
  }
  const ok = await writeFileContent(tab.fullPath, tab.content ?? "");
  // Edits made during the write must remain dirty.
  if (ok && currentState.tabs.find((t) => t.id === id)?.content === tab.content) {
    markFileClean(tab.id);
  }
}

/** A document provider reported unsaved changes (or their absence) for this pane. */
export function setFileDirty(id: string, dirty: boolean) {
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((t) =>
      t.id === id && !!t.isDirty !== dirty ? { ...t, isDirty: dirty } : t,
    ),
  }));
}

/** "Open with": the provider this document pane uses. */
export function setDocumentProvider(id: string, providerId: string) {
  setState((prev) => ({
    ...prev,
    tabs: prev.tabs.map((t) =>
      t.id === id && t.document ? { ...t, document: { providerId } } : t,
    ),
  }));
}

export function setActiveTab(id: string) {
  if (currentState.tabs.find((t) => t.id === id)?.hidden) {
    return;
  }
  setState((prev) => ({ ...prev, activeTabId: id }));
}
