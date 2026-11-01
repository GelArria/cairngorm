// MCP Apps host side of one view (SEP-1865): JSON-RPC over postMessage with its iframe.
// The view only reaches its own server, through native checks, and never app commands.
import { errorMessage } from "@/common/errors";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import type { PluginCall } from "../model/types";
import { forwardViewContextMenu } from "./view-context-menu";

const PROTOCOL = "2026-01-26";
const PROXIED = new Set(["tools/call", "resources/read", "ping"]);
const LINK_INTERVAL_MS = 3000;

interface Message {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export interface ViewHostOptions {
  call: PluginCall;
  frame: HTMLIFrameElement;
  hostContext: () => Record<string, unknown>;
  onInitialized?: () => void;
  /**
   * Only the first view of a call receives its input. A remounted view (reload, project
   * switch) shows the result without repeating work the input asks the view to do.
   */
  deliverInput: boolean;
}

export class ViewHost {
  private readonly origin: string;
  private initialized = false;
  /** A pane is the whole view: apps that can fill it are shown fullscreen. */
  private mode: "inline" | "fullscreen" = "inline";
  private outcome?: { result?: unknown; error?: string };
  private reports: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private lastLink = 0;
  private disposed = false;
  private preparing = false;
  private abortReload?: (error: Error) => void;
  private teardownDone = false;
  private proxySequence = 0;
  private canvas?: string;
  private reloadEpoch = 0;
  private inFlight = new Set<Promise<unknown>>();
  private replies = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private flush?: {
    after: number;
    canvas?: string;
    resolve: () => void;
    reject: (error: Error) => void;
  };

  constructor(private options: ViewHostOptions) {
    this.origin = new URL(options.call.viewUrl).origin;
    window.addEventListener("message", this.receive);
    this.report("opened");
  }

  /** The server's answer to the call that opened this view. */
  finish(result?: unknown, error?: string) {
    this.outcome = { result, error };
    if (this.initialized) {
      this.sendOutcome();
    }
  }

  contextChanged(partial: Record<string, unknown>) {
    if (this.initialized) {
      this.notify("ui/notifications/host-context-changed", partial);
    }
  }

  /** Save acknowledgement precedes fresh resource loading and correlated teardown. */
  async prepareReload(): Promise<void> {
    if (
      this.preparing ||
      this.disposed ||
      !this.initialized ||
      !this.outcome ||
      this.teardownDone
    ) {
      throw new Error("The view is not ready to reload or its opening call is still working.");
    }
    this.preparing = true;
    const epoch = ++this.reloadEpoch;
    const inert = this.options.frame.hasAttribute("inert");
    const pointerEvents = this.options.frame.style.pointerEvents;
    this.options.frame.setAttribute("inert", "");
    this.options.frame.style.pointerEvents = "none";
    this.options.frame.blur();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => {
      if (this.disposed || this.reloadEpoch !== epoch) {
        throw new Error("View reload was cancelled.");
      }
    };
    try {
      await Promise.race([
        (async () => {
          await this.reports;
          active();
          const result = this.outcome!.result as
            | { isError?: boolean; structuredContent?: { canvasId?: unknown } }
            | undefined;
          const failed =
            this.options.deliverInput && (this.outcome!.error != null || result?.isError === true);
          if (this.options.call.plugin === "tldraw" && !failed) {
            await new Promise<void>((resolve, reject) => {
              const canvas =
                this.canvas ??
                result?.structuredContent?.canvasId ??
                this.options.call.arguments.canvasId;
              this.flush = {
                after: this.proxySequence,
                canvas: typeof canvas === "string" ? canvas : undefined,
                resolve,
                reject,
              };
              this.contextChanged({
                displayMode: "inline",
                containerDimensions: this.options.hostContext().containerDimensions,
              });
            });
          }
          active();
          while (this.inFlight.size) {
            await Promise.allSettled([...this.inFlight]);
            active();
          }
          await invoke("plugin_prepare_reload", { callId: this.options.call.id });
          active();
          const id = `reload-teardown-${this.nextId++}`;
          await new Promise<void>((resolve, reject) => {
            this.replies.set(id, { resolve, reject });
            this.post({
              jsonrpc: "2.0",
              id,
              method: "ui/resource-teardown",
              params: { reason: "reload" },
            });
          });
          active();
          this.teardownDone = true;
        })(),
        new Promise<never>((_, reject) => {
          this.abortReload = reject;
          timer = setTimeout(
            () =>
              reject(
                new Error("The view did not acknowledge saving or teardown within five seconds."),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.reloadEpoch++;
      this.abortReload = undefined;
      const error = new Error("View reload ended.");
      this.flush?.reject(error);
      this.flush = undefined;
      for (const reply of this.replies.values()) {
        reply.reject(error);
      }
      this.replies.clear();
      if (!inert) {
        this.options.frame.removeAttribute("inert");
      }
      this.options.frame.style.pointerEvents = pointerEvents;
      this.preparing = false;
      if (!this.teardownDone && !this.disposed) {
        this.contextChanged({
          displayMode: this.mode,
          containerDimensions: this.options.hostContext().containerDimensions,
        });
      }
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    // Best effort: the view gets a chance to save; the pane is already going away.
    if (this.initialized && !this.teardownDone) {
      this.post({
        jsonrpc: "2.0",
        id: `teardown-${this.nextId++}`,
        method: "ui/resource-teardown",
        params: { reason: "closed" },
      });
    }
    this.disposed = true;
    this.reloadEpoch++;
    const error = new Error("The view was closed.");
    this.abortReload?.(error);
    this.flush?.reject(error);
    this.flush = undefined;
    for (const reply of this.replies.values()) {
      reply.reject(error);
    }
    this.replies.clear();
    window.removeEventListener("message", this.receive);
    this.report("closed");
  }

  private receive = (event: MessageEvent) => {
    // Only this iframe, at the gateway origin: other frames and windows are ignored.
    if (event.source !== this.options.frame.contentWindow || event.origin !== this.origin) {
      return;
    }
    const message = event.data as Message;
    if (!message || message.jsonrpc !== "2.0" || this.disposed) {
      return;
    }
    if (
      !message.method &&
      typeof message.id === "string" &&
      ("result" in message || "error" in message)
    ) {
      const reply = this.replies.get(message.id);
      if (reply) {
        this.replies.delete(message.id);
        if (message.error != null) {
          const error = message.error as { message?: unknown };
          reply.reject(
            new Error(
              typeof error.message === "string" ? error.message : errorMessage(message.error),
            ),
          );
        } else {
          reply.resolve();
        }
      }
    } else if (typeof message.method === "string" && message.id != null) {
      void this.request(message);
    } else if (typeof message.method === "string") {
      this.notification(message);
    }
  };

  private async request(message: Message) {
    const { id, method = "", params = {} } = message;
    try {
      this.reply(id!, await this.handle(method, params));
    } catch (error) {
      this.post({ jsonrpc: "2.0", id, error: { code: -32000, message: errorMessage(error) } });
    }
  }

  private async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "ui/initialize") {
      const view = this.options.call.view ?? {};
      const capabilities = params.appCapabilities as
        | { availableDisplayModes?: unknown }
        | undefined;
      const modes = Array.isArray(capabilities?.availableDisplayModes)
        ? capabilities.availableDisplayModes
        : [];
      // Respect a declared list; an app that declares none is shown filling the pane.
      this.mode = modes.length === 0 || modes.includes("fullscreen") ? "fullscreen" : "inline";
      return {
        protocolVersion:
          typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
        hostInfo: { name: "Cairngorm", version: "1" },
        hostCapabilities: {
          openLinks: {},
          serverTools: {},
          serverResources: {},
          logging: {},
          sandbox: { permissions: view.permissions ?? {}, csp: view.csp ?? {} },
        },
        hostContext: {
          ...this.options.hostContext(),
          displayMode: this.mode,
          availableDisplayModes: [this.mode],
        },
      };
    }
    if (PROXIED.has(method)) {
      const sequence = ++this.proxySequence;
      const pending = invoke<Record<string, unknown>>("plugin_view_request", {
        callId: this.options.call.id,
        method,
        params,
      });
      this.inFlight.add(pending);
      const flushSave = () => {
        const args = params.arguments as Record<string, unknown> | undefined;
        return (
          this.flush &&
          sequence > this.flush.after &&
          method === "tools/call" &&
          params.name === "save_checkpoint" &&
          this.flush.canvas != null &&
          (args?.canvasId == null || args.canvasId === this.flush.canvas)
        );
      };
      try {
        const result = await pending;
        const canvas = (params.arguments as Record<string, unknown> | undefined)?.canvasId;
        if (
          method === "tools/call" &&
          params.name === "save_checkpoint" &&
          result?.isError !== true &&
          typeof canvas === "string"
        ) {
          this.canvas = canvas;
        }
        if (flushSave()) {
          if (result?.isError === true) {
            this.flush!.reject(new Error("The canvas checkpoint could not be saved."));
          } else {
            this.flush!.resolve();
          }
        }
        return result;
      } catch (error) {
        if (flushSave()) {
          this.flush!.reject(new Error(errorMessage(error)));
        }
        throw error;
      } finally {
        this.inFlight.delete(pending);
      }
    }
    if (method === "ui/update-model-context") {
      const sequence = ++this.proxySequence;
      const report = (await this.report("context", params)) as
        | { emptyCanvasWithoutCheckpoint?: boolean }
        | undefined;
      if (
        this.flush &&
        sequence > this.flush.after &&
        report?.emptyCanvasWithoutCheckpoint === true
      ) {
        this.flush.resolve();
      }
      return {};
    }
    if (method === "ui/open-link") {
      const url = new URL(String(params.url ?? ""));
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Only web links can be opened");
      }
      // A view must not flood the browser with tabs.
      const now = Date.now();
      if (now - this.lastLink < LINK_INTERVAL_MS) {
        throw new Error("Links are opened at most once every few seconds");
      }
      this.lastLink = now;
      await open(url.href);
      return {};
    }
    if (method === "ui/request-display-mode") {
      return { mode: this.mode };
    }
    // ui/message and downloads need a chat surface; terminal agents have none yet.
    throw new Error(`${method} is not supported by Cairngorm`);
  }

  private notification(message: Message) {
    if (message.method === "ui/notifications/initialized" && !this.initialized) {
      this.initialized = true;
      // The input report is queued before posting, so earlier (restored) reports precede it.
      if (this.options.deliverInput) {
        this.report("input");
        this.notify("ui/notifications/tool-input", { arguments: this.options.call.arguments });
      }
      // Some views only apply a display mode from context changes, not the initial context.
      const { containerDimensions } = this.options.hostContext();
      this.notify("ui/notifications/host-context-changed", {
        displayMode: this.mode,
        containerDimensions,
      });
      if (this.outcome) {
        this.sendOutcome();
      }
      this.options.onInitialized?.();
    } else if (message.method === "cairngorm/context-menu") {
      forwardViewContextMenu(this.options.frame, message.params ?? {});
    } else if (message.method === "notifications/message") {
      console.debug(`[plugin ${this.options.call.plugin}]`, message.params);
    }
  }

  private sendOutcome() {
    // A remounted tldraw consumes the acknowledged bootstrap, never the older exec result.
    if (this.options.call.plugin === "tldraw" && !this.options.deliverInput) return;
    const { result, error } = this.outcome!;
    if (error != null) {
      this.notify("ui/notifications/tool-cancelled", { reason: error });
    } else {
      this.notify("ui/notifications/tool-result", (result ?? {}) as Record<string, unknown>);
    }
  }

  /** Reports reach native code in the order the view produced them. */
  private report(event: string, payload: unknown = null) {
    const callId = this.options.call.id;
    this.reports = this.reports
      .catch(() => undefined)
      .then(() =>
        invoke<{ canvasId?: unknown; emptyCanvasWithoutCheckpoint?: boolean }>(
          "plugin_view_event",
          { callId, event, payload },
        ),
      )
      .then((metadata) => {
        if (typeof metadata?.canvasId === "string") {
          this.canvas = metadata.canvasId;
        }
        return metadata;
      })
      .catch((error) => console.warn("[plugins] view report failed", errorMessage(error)));
    return this.reports;
  }

  private reply(id: string | number, result: unknown) {
    this.post({ jsonrpc: "2.0", id, result: result ?? {} });
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.post({ jsonrpc: "2.0", method, params });
  }

  private post(message: Message) {
    if (!this.disposed) this.options.frame.contentWindow?.postMessage(message, this.origin);
  }
}
