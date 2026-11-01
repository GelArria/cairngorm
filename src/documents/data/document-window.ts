// A document moved into its own window. The tab stays in the main store (hidden, like a
// detached terminal), so closing the window or restarting Cairngorm brings it back.
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import tauriConf from "../../../src-tauri/tauri.conf.json";

/** Native accepts saves and agent snapshots only from `main` and labels with this prefix. */
export const DOCUMENT_WINDOW_PREFIX = "detached-doc-";
/** Document window → main: put the tab back in the main window. */
export const DOCUMENT_REATTACH = "document-window-reattach";
/** Document window → main: listeners are in place, so operations can be forwarded. */
export const DOCUMENT_WINDOW_READY = "document-window-ready";
/** Document window → main: unsaved changes, so closing Cairngorm asks first. */
export const DOCUMENT_WINDOW_DIRTY = "document-window-dirty";
/** Main → document window: an agent operation for the document it shows. */
export const DOCUMENT_WINDOW_OPERATION = "document-window-operation";

// WebView2 needs the same browser arguments in every window that shares its data folder.
const MAIN_BROWSER_ARGS = tauriConf.app.windows[0].additionalBrowserArgs;

/** Everything a document window needs; never content, credentials or provider code. */
export interface DocumentWindowPayload {
  tabId: string;
  title: string;
  extension: string;
  path: string;
  scope: string;
  providerId?: string;
  ticket?: string;
}

export function documentWindowLabel(tabId: string) {
  return `${DOCUMENT_WINDOW_PREFIX}${tabId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Opens (or focuses) the window; resolves its label, or `null` if it could not be created. */
export async function openDocumentWindow(payload: DocumentWindowPayload): Promise<string | null> {
  const label = documentWindowLabel(payload.tabId);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return label;
  }
  const base = window.location.href.split("?")[0];
  const url = `${base}?document=${encodeURIComponent(JSON.stringify(payload))}`;
  const options = {
    url,
    title: payload.title,
    width: Math.min(1100, window.screen.availWidth - 80),
    height: Math.min(900, window.screen.availHeight - 80),
    resizable: true,
  };
  const win = new WebviewWindow(label, {
    ...options,
    additionalBrowserArgs: MAIN_BROWSER_ARGS,
  } as typeof options);
  return new Promise((resolve) => {
    win.once("tauri://created", () => resolve(label));
    win.once("tauri://error", () => resolve(null));
  });
}

export async function focusDocumentWindow(label: string) {
  await (await WebviewWindow.getByLabel(label))?.setFocus();
}

/** The payload of this window, when it is a document window. */
export function documentWindowPayload(): DocumentWindowPayload | null {
  const raw = new URLSearchParams(window.location.search).get("document");
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<DocumentWindowPayload>;
    const text = (field: unknown) => typeof field === "string" && field.length > 0;
    if (!text(value.tabId) || !text(value.title) || !text(value.path) || !text(value.scope)) {
      return null;
    }
    return {
      tabId: value.tabId!,
      title: value.title!,
      extension: typeof value.extension === "string" ? value.extension : "",
      path: value.path!,
      scope: value.scope!,
      providerId: text(value.providerId) ? value.providerId : undefined,
      ticket: text(value.ticket) ? value.ticket : undefined,
    };
  } catch {
    return null;
  }
}

export function isDocumentWindow() {
  return new URLSearchParams(window.location.search).has("document");
}
