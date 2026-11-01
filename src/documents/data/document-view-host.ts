// Host side of one isolated provider view. The iframe runs third-party code on its own
// loopback origin; it receives only this session's snapshot, reports status, and (when the
// session allows editing) hands bytes back for Cairngorm to save.
import { HOST_MAX_BYTES, type DocumentSnapshot } from "../model/provider";
import {
  DOCUMENT_PROTOCOL_VERSION,
  parseProviderMessage,
  providerErrorMessage,
  type ProtocolMessage,
} from "../model/view-protocol";
import { ViewRequests } from "./view-requests";

const READY_TIMEOUT_MS = 15000;
const SAVE_TIMEOUT_MS = 15000;
const OPERATION_TIMEOUT_MS = 30000;
/** Copies of one version a view may request; each copy can be up to 32 MiB of app memory. */
const MAX_READS_PER_VERSION = 8;

/** The view has not finished loading; only this error makes agent operations wait and retry. */
export class ViewNotReadyError extends Error {
  constructor() {
    super("The document view is not ready.");
  }
}

export interface DocumentViewHostOptions {
  frame: HTMLIFrameElement;
  /** Origin of the page in the frame; messages from anywhere else are ignored. */
  origin: string;
  snapshot: () => DocumentSnapshot;
  context: () => Record<string, unknown>;
  /** The provider declares "edit" and this session has a file Cairngorm can save. */
  canEdit?: boolean;
  onReady: () => void;
  onError: (message: string) => void;
  onDirty?: (dirty: boolean) => void;
  readyTimeoutMs?: number;
}

export class DocumentViewHost {
  readonly sessionId = crypto.randomUUID();
  private initialized = false;
  private ready = false;
  private disposed = false;
  private reads = { version: "", count: 0 };
  /** The version the view already holds (read or saved); changes to it are not re-announced. */
  private viewVersion = "";
  private readyTimer: ReturnType<typeof setTimeout>;
  private requests = new ViewRequests();

  constructor(private options: DocumentViewHostOptions) {
    window.addEventListener("message", this.receive);
    this.readyTimer = setTimeout(() => {
      if (!this.ready && !this.disposed) {
        options.onError(
          "The provider did not finish loading. It may be incompatible with this Cairngorm.",
        );
      }
    }, options.readyTimeoutMs ?? READY_TIMEOUT_MS);
  }

  /** A newer version of the same document: the view re-reads it when it is ready to. */
  documentChanged() {
    if (this.initialized && this.options.snapshot().version !== this.viewVersion) {
      this.notify("document/changed", { document: this.metadata() });
    }
  }

  contextChanged(partial: Record<string, unknown>) {
    if (this.initialized) {
      this.notify("host/context-changed", partial);
    }
  }

  /** Asks the view for the document to save; bounded in time and size. */
  async requestSave(): Promise<Uint8Array> {
    if (!this.options.canEdit || !this.ready) {
      throw new Error("This document cannot be saved right now.");
    }
    const result = (await this.requests.start("save", SAVE_TIMEOUT_MS, (id) =>
      this.post({ jsonrpc: "2.0", id, method: "document/save", params: {} }),
    )) as { bytes?: unknown } | undefined;
    const bytes = result?.bytes;
    if (Object.prototype.toString.call(bytes) !== "[object ArrayBuffer]") {
      throw new Error("The provider returned no document to save.");
    }
    if ((bytes as ArrayBuffer).byteLength > HOST_MAX_BYTES) {
      throw new Error("The document is larger than 32 MiB and was not saved.");
    }
    return new Uint8Array(bytes as ArrayBuffer);
  }

  /** Tells the view which version Cairngorm committed, so it is not asked to reload. */
  saved(snapshot: DocumentSnapshot) {
    this.viewVersion = snapshot.version;
    const { name, extension, mimeType, bytes, version } = snapshot;
    this.notify("document/saved", {
      document: { name, extension, mimeType, size: bytes.byteLength, version },
    });
  }

  /** Runs one declared operation in the view and returns its JSON result. */
  async operate(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.ready) {
      throw new ViewNotReadyError();
    }
    const result = (await this.requests.start("operation", OPERATION_TIMEOUT_MS, (id) =>
      this.post({
        jsonrpc: "2.0",
        id,
        method: "document/operation",
        params: { name, arguments: args },
      }),
    )) as { value?: unknown } | undefined;
    return result?.value ?? null;
  }

  /** Teardown is best effort; nothing the view sends afterwards is processed. */
  dispose() {
    if (this.disposed) {
      return;
    }
    if (this.initialized) {
      this.post({
        jsonrpc: "2.0",
        id: `host-teardown-${this.sessionId}`,
        method: "document/teardown",
        params: { reason: "closed" },
      });
    }
    this.disposed = true;
    clearTimeout(this.readyTimer);
    this.requests.cancel("The document view was closed.");
    window.removeEventListener("message", this.receive);
  }

  private metadata() {
    const { name, extension, mimeType, bytes, version } = this.options.snapshot();
    return { name, extension, mimeType, size: bytes.byteLength, version };
  }

  private receive = (event: MessageEvent) => {
    if (
      this.disposed ||
      event.source !== this.options.frame.contentWindow ||
      event.origin !== this.options.origin
    ) {
      return;
    }
    const message = parseProviderMessage(event.data);
    if (message.kind === "request") {
      this.request(message.id, message.method, message.params);
    } else if (message.kind === "response") {
      this.requests.settle(message.id, message.error, message.result);
    } else if (message.kind === "notification" && this.initialized) {
      if (message.method === "document/ready" && !this.ready) {
        this.ready = true;
        clearTimeout(this.readyTimer);
        this.options.onReady();
      } else if (message.method === "document/error") {
        this.options.onError(providerErrorMessage(message.params));
      } else if (message.method === "document/dirty" && this.options.canEdit) {
        this.options.onDirty?.(message.params.dirty === true);
      }
    }
  };

  private request(id: string | number, method: string, params: Record<string, unknown>) {
    if (method === "document/initialize") {
      if (params.protocolVersion !== DOCUMENT_PROTOCOL_VERSION) {
        this.fail(
          id,
          -32602,
          `Unsupported document protocol. Cairngorm speaks version ${DOCUMENT_PROTOCOL_VERSION}.`,
        );
        return;
      }
      // A provider page that reloads itself starts a fresh handshake on the same session.
      this.initialized = true;
      this.ready = false;
      this.reads = { version: "", count: 0 };
      this.viewVersion = "";
      this.options.onDirty?.(false);
      this.post({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: DOCUMENT_PROTOCOL_VERSION,
          host: { name: "Cairngorm" },
          session: { id: this.sessionId },
          document: this.metadata(),
          capabilities: { view: true, edit: Boolean(this.options.canEdit) },
          context: this.options.context(),
        },
      });
    } else if (method === "document/read" && this.initialized) {
      const { bytes, version } = this.options.snapshot();
      this.reads = { version, count: this.reads.version === version ? this.reads.count + 1 : 1 };
      if (this.reads.count > MAX_READS_PER_VERSION) {
        this.fail(id, -32003, "This version was already read; read again after document/changed.");
        return;
      }
      this.viewVersion = version;
      // A copy: the provider cannot alter the host's snapshot.
      this.post({ jsonrpc: "2.0", id, result: { version, bytes: bytes.slice().buffer } });
    } else if (method === "document/read") {
      this.fail(id, -32002, "Initialize the session before reading the document.");
    } else {
      this.fail(id, -32601, "Method not supported by Cairngorm.");
    }
  }

  private fail(id: string | number, code: number, message: string) {
    this.post({ jsonrpc: "2.0", id, error: { code, message } });
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.post({ jsonrpc: "2.0", method, params });
  }

  private post(message: ProtocolMessage) {
    if (!this.disposed) {
      // The target origin keeps document bytes from reaching a navigated-away frame.
      this.options.frame.contentWindow?.postMessage(message, this.options.origin);
    }
  }
}
