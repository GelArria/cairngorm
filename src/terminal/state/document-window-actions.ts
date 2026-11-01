// Document tabs moved into their own window. Unlike terminals, the window holds no session:
// it shows the same file through the same document pane and hands the tab back when closed.
import { DOCUMENT_WINDOW_PREFIX, openDocumentWindow, samePath } from "@/documents/api";
import { finalizeLayout } from "../model/layout/finalize";
import { activeInline } from "../model/layout/geometry";
import { normalizeLayout } from "../model/layout/normalize";
import type { TermTab, TileLayout } from "../model/types";
import { detachTab } from "./detached-workspace";
import { isDocumentTab } from "./file-actions";
import { currentState, setState } from "./terminal-store";

/** Windows whose listeners are in place; only these receive forwarded agent operations. */
const readyWindows = new Set<string>();

export const markDocumentWindowReady = (label: string) => void readyWindows.add(label);
export const isDocumentWindowReady = (label: string) => readyWindows.has(label);

const isDocumentWindowTab = (tab: TermTab) =>
  tab.kind === "file" && !!tab.detachedWindowLabel?.startsWith(DOCUMENT_WINDOW_PREFIX);

/**
 * Opens the document tab in its own window. Only documents backed by a file can move, not
 * with unsaved edits (they live in this pane's provider view), and not while another tab of
 * the same project shows the same file (unsaved edits there would race this window's saves).
 */
export async function detachDocumentTab(id: string): Promise<boolean> {
  const tab = currentState.tabs.find((t) => t.id === id);
  if (
    !tab ||
    tab.kind !== "file" ||
    tab.detached ||
    tab.isDirty ||
    !tab.fullPath ||
    !isDocumentTab(tab)
  ) {
    return false;
  }
  const group = tab.groupId ?? "g1";
  const twin = currentState.tabs.some(
    (t) =>
      t.id !== id &&
      t.kind === "file" &&
      (t.groupId ?? "g1") === group &&
      !!t.fullPath &&
      samePath(t.fullPath, tab.fullPath!),
  );
  if (twin) {
    return false;
  }
  const label = await openDocumentWindow({
    tabId: tab.id,
    title: tab.title,
    extension: tab.extension ?? "",
    path: tab.fullPath,
    scope: group,
    providerId: tab.document?.providerId,
    ticket: tab.documentTicket,
  }).catch((error) => {
    console.warn("[documents] Could not open a document window", error);
    return null;
  });
  if (!label) {
    return false;
  }
  detachTab(id, label);
  return true;
}

/** The window closed or asked to move back: the tab returns to its own project's grid. */
export function reattachDocumentTab(id: string, providerId?: string) {
  setState((prev) => {
    const tab = prev.tabs.find((t) => t.id === id);
    // Only document windows hand tabs back; a detached terminal is never touched here.
    if (!tab?.detached || !isDocumentWindowTab(tab)) {
      return prev;
    }
    readyWindows.delete(tab.detachedWindowLabel!);
    const tabs = prev.tabs.map((t) =>
      t.id === id
        ? {
            ...t,
            detached: false,
            detachedWindowLabel: undefined,
            // Edits left in a closed window were discarded there.
            isDirty: false,
            // The window's own "Open with" choice comes back with it.
            document: t.document ? { providerId: providerId ?? t.document.providerId } : t.document,
          }
        : t,
    );
    const { [tab.detachedWindowLabel ?? ""]: _closed, ...detachedLayouts } =
      prev.detachedLayouts ?? {};
    if ((tab.groupId ?? "g1") !== prev.activeGroupId) {
      return { ...prev, tabs, detachedLayouts };
    }
    return {
      ...prev,
      tabs,
      detachedLayouts,
      layout: finalizeLayout(
        normalizeLayout(activeInline(tabs, prev.activeGroupId), prev.layout) as TileLayout,
      ),
      activeTabId: id,
    };
  });
}

/** Focuses a document's window, or brings the tab back if that window no longer exists. */
export async function focusDocumentWindowOrRecover(label: string) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const window = await WebviewWindow.getByLabel(label).catch(() => null);
  if (window) {
    await window.setFocus();
    return;
  }
  const tab = currentState.tabs.find((t) => t.detachedWindowLabel === label);
  if (tab) {
    reattachDocumentTab(tab.id);
  }
}
