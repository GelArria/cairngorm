// Generated from document-sdk.ts by scripts/build-document-sdk.mjs. Do not edit.
export declare const PROTOCOL_VERSION = "1";
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
    containerDimensions?: {
        width: number;
        height: number;
    };
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
    readonly session: {
        id: string;
    };
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
    onOperation(name: string, handler: (args: Record<string, unknown>) => unknown | Promise<unknown>): void;
    close(): void;
}
/** Where messages go and where replies arrive; `window.parent` and `window` in a page. */
export interface DocumentTransport {
    host: {
        postMessage(message: unknown, targetOrigin: string): void;
    };
    events: Pick<Window, "addEventListener" | "removeEventListener">;
    timeoutMs?: number;
}
/** Connect the provider page to the Cairngorm pane that embeds it. */
export declare function connect(options?: Partial<DocumentTransport>): Promise<DocumentHost>;
/** The transport-independent client, exposed for conformance tests. */
export declare function createDocumentClient({ host, events, timeoutMs, }: DocumentTransport): DocumentHost & {
    connect(): Promise<DocumentHost>;
};
