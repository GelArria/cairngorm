// Snapshots are the only content a provider ever sees: bounded bytes plus a content version.
import { invoke } from "@tauri-apps/api/core";
import type { DocumentSnapshot } from "../model/provider";

export interface SnapshotSource {
  name: string;
  extension: string;
  mimeType: string;
  maxBytes: number;
  /** A file on disk, read natively with the size limit enforced before reading. */
  path?: string;
  /** Content supplied by a drop or paste, already in memory. */
  dataUrl?: string;
  /** An agent-opened snapshot held natively: exactly the bytes that were authorized. */
  ticket?: string;
}

function tooLarge(maxBytes: number) {
  return new Error(
    `The document is too large to open (${Math.ceil(maxBytes / 1024 / 1024)} MiB maximum).`,
  );
}

function toBytes(value: unknown): Uint8Array {
  // Tag check, not instanceof: IPC buffers can come from another realm.
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return new Uint8Array(value as ArrayBuffer);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  throw new Error("The document could not be read.");
}

export function decodeDataUrl(dataUrl: string, maxBytes: number): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) {
    throw new Error("The supplied document is not a data URL.");
  }
  const body = dataUrl.slice(comma + 1);
  // Base64 expands by 4/3: refuse before decoding anything too large.
  if (Math.floor((body.length * 3) / 4) > maxBytes + 2) {
    throw tooLarge(maxBytes);
  }
  const base64 = dataUrl.slice(0, comma).endsWith(";base64");
  const bytes = base64
    ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(body));
  if (bytes.byteLength > maxBytes) {
    throw tooLarge(maxBytes);
  }
  return bytes;
}

export async function contentVersion(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `null` once the ticket was evicted; the pane then shows the file on disk instead. */
export async function readTicket(ticket: string): Promise<Uint8Array | null> {
  try {
    return toBytes(await invoke("document_ticket_read", { ticket }));
  } catch {
    return null;
  }
}

export async function readSnapshot(source: SnapshotSource): Promise<DocumentSnapshot> {
  let bytes: Uint8Array;
  const ticketBytes = source.ticket ? await readTicket(source.ticket) : null;
  if (source.ticket && !ticketBytes) {
    // Never fall back to the path silently: that file may have been replaced since the agent
    // opened it. Reloading (the user's choice) shows the file on disk instead.
    throw new Error(
      "The snapshot the agent opened is no longer available. Use Try again to show the file as it is on disk now.",
    );
  }
  if (ticketBytes) {
    if (ticketBytes.byteLength > source.maxBytes) {
      throw tooLarge(source.maxBytes);
    }
    bytes = ticketBytes;
  } else if (source.dataUrl) {
    bytes = decodeDataUrl(source.dataUrl, source.maxBytes);
  } else if (source.path) {
    bytes = toBytes(
      await invoke("document_read_snapshot", { path: source.path, maxBytes: source.maxBytes }),
    );
  } else {
    // Only dropped or pasted documents have no path, and their content is not kept.
    throw new Error(
      "This dropped document was not kept after Cairngorm restarted. Drop the file again to view it.",
    );
  }
  return {
    name: source.name,
    extension: source.extension,
    mimeType: source.mimeType,
    bytes,
    version: await contentVersion(bytes),
  };
}
