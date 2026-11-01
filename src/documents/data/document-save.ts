// Host-owned saving: the provider's bytes go to native as a raw IPC body; native checks the
// version the provider edited, keeps a backup and replaces the file atomically.
import { invoke } from "@tauri-apps/api/core";

export const DOCUMENT_SAVE_REQUEST = "document-save-request";

/** Returns the saved content's version (SHA-256). */
export function saveDocument(path: string, expectedVersion: string, bytes: Uint8Array) {
  return invoke<string>("document_save", bytes, {
    headers: {
      "x-document-path": encodeURIComponent(path),
      "x-document-version": expectedVersion,
    },
  });
}

/** Ctrl+S and menu saves address a document pane by its pane id. */
export function requestDocumentSave(paneId: string) {
  window.dispatchEvent(new CustomEvent(DOCUMENT_SAVE_REQUEST, { detail: paneId }));
}
