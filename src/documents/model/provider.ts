// The document-provider contract. A provider interprets one or more file types and owns
// its view; Cairngorm owns the session: which bytes, which version, and its lifecycle.

export interface DocumentFileType {
  label: string;
  extensions: string[];
  mimeTypes: string[];
}

/** A typed action an agent can run on an open document (manifest "operations"). */
export interface DocumentOperation {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** What every provider declares, built in or installed. */
export interface DocumentProviderInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  fileTypes: DocumentFileType[];
  /** SDK v1 providers only render ("view"); nothing implies saving. */
  capabilities: string[];
  maxBytes: number;
  operations?: DocumentOperation[];
  source: "builtin" | "installed";
}

/** An installed provider whose files changed after approval: listed, never loaded. */
export interface BrokenDocumentProvider {
  id: string;
  error: string;
}

/** Authorized, bounded content for one opened document. */
export interface DocumentSnapshot {
  name: string;
  extension: string;
  mimeType: string;
  bytes: Uint8Array;
  /** SHA-256 of the bytes: refreshes publish a new version only when content changed. */
  version: string;
}

/** A mounted provider view the session can ask to save or to run an operation. */
export interface LiveDocumentView {
  requestSave(): Promise<Uint8Array>;
  saved(snapshot: DocumentSnapshot): void;
  operate(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Built-in views receive the same snapshot and report the same lifecycle as isolated ones. */
export interface DocumentViewProps {
  snapshot: DocumentSnapshot;
  title: string;
  onReady: () => void;
  onError: (message: string) => void;
  /** Editing is offered only by providers declaring "edit" for a file Cairngorm can save. */
  canEdit?: boolean;
  onDirty?: (dirty: boolean) => void;
  onLiveView?: (view: LiveDocumentView | null) => void;
}

/** Native `document_providers_list` row. */
export interface InstalledProviderRow {
  id: string;
  manifest: Omit<DocumentProviderInfo, "source"> | null;
  error: string | null;
}

/** Native `document_provider_inspect` result shown before approval. */
export interface ProviderInspection {
  manifest: Omit<DocumentProviderInfo, "source">;
  approvalHash: string;
  files: number;
  bytes: number;
  replaces: string | null;
}

export const HOST_MAX_BYTES = 32 * 1024 * 1024;
