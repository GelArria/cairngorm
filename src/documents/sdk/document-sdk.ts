// Cairngorm document provider SDK, protocol v1. Written in TypeScript; Cairngorm serves the
// compiled module to every installed provider at /_cairngorm/document-sdk.js:
//
//   import { connect } from "/_cairngorm/document-sdk.js";
//   const host = await connect();
//   render(await host.read());
//   host.ready();
//
// The SDK speaks JSON-RPC 2.0 over postMessage with the Cairngorm pane that embeds the
// provider. Providers never receive a file path, filesystem access or network access.
// Regenerate dist/ after editing: `node scripts/build-document-sdk.mjs`.

export const PROTOCOL_VERSION = "1";
const REQUEST_TIMEOUT_MS = 10000;
const TEARDOWN_TIMEOUT_MS = 2000;
const MAX_ERROR_LENGTH = 500;

/** The opened document. Content is read separately with `read()`. */
export interface DocumentInfo {
  name: string;
  extension: string;
  mimeType: string;
  size: number;
  /** Content version (SHA-256); changes when the document is refreshed with new bytes. */
  version: string;
}

export interface HostContext {
  theme?: "light" | "dark";
  /** CSS colors of the surrounding pane, such as `background` and `foreground`. */
  colors?: Record<string, string>;
  containerDimensions?: { width: number; height: number };
  locale?: string;
}

export interface HostCapabilities {
  view: boolean;
  edit: boolean;
}

export interface TeardownInfo {
  reason: string;
}

export interface DocumentHost {
  readonly document: DocumentInfo;
  readonly context: HostContext;
  readonly capabilities: HostCapabilities;
  readonly session: { id: string };
  /** The current document bytes. Call again after `onDocumentChange`. */
  read(): Promise<Uint8Array>;
  readText(encoding?: string): Promise<string>;
  /** The document is rendered and interactive. */
  ready(): void;
  /** A failure Cairngorm shows in the pane, for example a corrupt file. */
  reportError(error: unknown): void;
  onContextChange(listener: (context: HostContext) => void): () => void;
  onDocumentChange(listener: (document: DocumentInfo) => void): () => void;
  /** Runs before the pane closes; keep it short (two seconds at most). */
  onTeardown(listener: (info: TeardownInfo) => void | Promise<void>): () => void;
  /** "edit" providers: tell Cairngorm whether there are unsaved changes. */
  setDirty(dirty: boolean): void;
  /**
   * "edit" providers: return the document to save. Cairngorm writes it (with a version check
   * and a backup); the provider never touches the file itself.
   */
  onSave(handler: () => Uint8Array | string | Promise<Uint8Array | string>): void;
  /** The save Cairngorm just committed; `document.version` is the new version. */
  onSaved(listener: (document: DocumentInfo) => void): () => void;
  /**
   * Declared operations (manifest "operations") that agents can run through Cairngorm.
   * The result must be JSON; return `{ changed: true }` style data, never code.
   */
  onOperation(
    name: string,
    handler: (args: Record<string, unknown>) => unknown | Promise<unknown>,
  ): void;
  close(): void;
}

/** Where messages go and where replies arrive; `window.parent` and `window` in a page. */
export interface DocumentTransport {
  host: { postMessage(message: unknown, targetOrigin: string): void };
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  timeoutMs?: number;
}

interface Message {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code?: number; message?: unknown };
}

interface Pending {
  resolve: (value: { result: any; origin: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type Listener<T> = (value: T) => unknown;

/** Connect the provider page to the Cairngorm pane that embeds it. */
export function connect(options: Partial<DocumentTransport> = {}): Promise<DocumentHost> {
  return createDocumentClient({ host: window.parent, events: window, ...options }).connect();
}

/** The transport-independent client, exposed for conformance tests. */
export function createDocumentClient({
  host,
  events,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: DocumentTransport) {
  let hostOrigin = "*";
  let nextId = 1;
  let closed = false;
  const pending = new Map<string | number, Pending>();
  const listeners = {
    context: new Set<Listener<HostContext>>(),
    change: new Set<Listener<DocumentInfo>>(),
    teardown: new Set<Listener<TeardownInfo>>(),
    saved: new Set<Listener<DocumentInfo>>(),
  };
  let saveHandler: (() => Uint8Array | string | Promise<Uint8Array | string>) | null = null;
  const operations = new Map<string, (args: Record<string, unknown>) => unknown>();
  const state = {
    document: null as unknown as DocumentInfo,
    context: {} as HostContext,
    capabilities: { view: true, edit: false } as HostCapabilities,
    session: { id: "" },
  };

  const send = (message: Omit<Message, "jsonrpc">) => {
    if (!closed) {
      host.postMessage({ jsonrpc: "2.0", ...message }, hostOrigin);
    }
  };

  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<{ result: any; origin: string }>((resolve, reject) => {
      if (closed) {
        reject(new Error("The document session has ended."));
        return;
      }
      const id = `provider-${nextId++}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Cairngorm did not answer ${method} in time.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });

  function emit<T>(set: Set<Listener<T>>, value: T) {
    for (const listener of set) {
      try {
        listener(value);
      } catch (error) {
        console.error(error);
      }
    }
  }

  const teardown = async (id: string | number, info: TeardownInfo) => {
    const work = [...listeners.teardown].map((listener) =>
      Promise.resolve().then(() => listener(info)),
    );
    await Promise.race([
      Promise.allSettled(work),
      new Promise((resolve) => setTimeout(resolve, TEARDOWN_TIMEOUT_MS)),
    ]);
    send({ id, result: {} });
    close();
  };

  // Requests Cairngorm sends to the provider: saving and declared operations.
  const answer = async (id: string | number, method: string, params: Record<string, any>) => {
    try {
      if (method === "document/save") {
        if (!saveHandler) {
          throw new Error("This provider cannot save.");
        }
        const output = await saveHandler();
        const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
        send({ id, result: { bytes: bytes.slice().buffer } });
        return;
      }
      const handler = operations.get(String(params.name ?? ""));
      if (!handler) {
        throw new Error(`Operation ${String(params.name)} is not available.`);
      }
      const result = await handler((params.arguments ?? {}) as Record<string, unknown>);
      send({
        id,
        result: { value: result === undefined ? null : JSON.parse(JSON.stringify(result)) },
      });
    } catch (error) {
      send({
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  const receive = (event: MessageEvent) => {
    if (event.source !== (host as unknown) || (hostOrigin !== "*" && event.origin !== hostOrigin)) {
      return;
    }
    const message = event.data as Message;
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
      return;
    }
    const waiting = message.id !== undefined ? pending.get(message.id) : undefined;
    if (message.method === undefined && waiting) {
      pending.delete(message.id!);
      clearTimeout(waiting.timer);
      if (message.error) {
        waiting.reject(new Error(String(message.error.message ?? "Request failed")));
      } else {
        waiting.resolve({ result: message.result, origin: event.origin });
      }
    } else if (message.method === "document/teardown" && message.id != null) {
      void teardown(message.id, { reason: String(message.params?.reason ?? "closed") });
    } else if (message.method === "host/context-changed") {
      state.context = { ...state.context, ...(message.params ?? {}) };
      emit(listeners.context, state.context);
    } else if (message.method === "document/changed") {
      state.document = { ...state.document, ...(message.params?.document ?? {}) };
      emit(listeners.change, state.document);
    } else if (message.method === "document/saved") {
      state.document = { ...state.document, ...(message.params?.document ?? {}) };
      emit(listeners.saved, state.document);
    } else if (
      (message.method === "document/save" || message.method === "document/operation") &&
      message.id != null
    ) {
      void answer(message.id, message.method, message.params ?? {});
    } else if (message.id != null && typeof message.method === "string") {
      send({
        id: message.id,
        error: { code: -32601, message: `${message.method} is not supported` },
      });
    }
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    events.removeEventListener("message", receive as EventListener);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("The document session has ended."));
    }
    pending.clear();
  };

  function subscribe<T>(set: Set<Listener<T>>) {
    return (listener: Listener<T>) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
  }

  const client: DocumentHost & { connect(): Promise<DocumentHost> } = {
    get document() {
      return state.document;
    },
    get context() {
      return state.context;
    },
    get capabilities() {
      return state.capabilities;
    },
    get session() {
      return state.session;
    },
    async read() {
      const { result } = await request("document/read");
      state.document = { ...state.document, version: result.version };
      return new Uint8Array(result.bytes);
    },
    async readText(encoding = "utf-8") {
      return new TextDecoder(encoding).decode(await client.read());
    },
    ready() {
      send({ method: "document/ready", params: {} });
    },
    reportError(error: unknown) {
      const message = String(error instanceof Error ? error.message : error).slice(
        0,
        MAX_ERROR_LENGTH,
      );
      send({ method: "document/error", params: { message } });
    },
    onContextChange: subscribe(listeners.context),
    onDocumentChange: subscribe(listeners.change),
    onTeardown: subscribe(listeners.teardown),
    setDirty(dirty: boolean) {
      send({ method: "document/dirty", params: { dirty: Boolean(dirty) } });
    },
    onSave(handler) {
      saveHandler = handler;
    },
    onSaved: subscribe(listeners.saved),
    onOperation(name, handler) {
      operations.set(name, handler);
    },
    close,
    async connect() {
      events.addEventListener("message", receive as EventListener);
      const { result, origin } = await request("document/initialize", {
        protocolVersion: PROTOCOL_VERSION,
      });
      if (result?.protocolVersion !== PROTOCOL_VERSION) {
        close();
        throw new Error(
          `Cairngorm speaks document protocol ${result?.protocolVersion}, not ${PROTOCOL_VERSION}.`,
        );
      }
      // Later messages must come from the same embedding origin.
      hostOrigin = origin && origin !== "null" ? origin : hostOrigin;
      state.document = result.document;
      state.context = result.context ?? {};
      state.capabilities = result.capabilities ?? state.capabilities;
      state.session = result.session;
      return client;
    },
  };
  return client;
}
