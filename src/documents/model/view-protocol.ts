// Host side of the document provider protocol (v1): JSON-RPC 2.0 over postMessage.
// Every message is untrusted input from provider code; this module only shapes and checks it.

export const DOCUMENT_PROTOCOL_VERSION = "1";

export const PROVIDER_REQUESTS = new Set(["document/initialize", "document/read"]);
export const PROVIDER_NOTIFICATIONS = new Set([
  "document/ready",
  "document/error",
  "document/dirty",
]);
const MAX_ID_LENGTH = 64;
export const MAX_PROVIDER_ERROR_LENGTH = 500;

export interface ProtocolMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

export type ParsedMessage =
  | { kind: "request"; id: string | number; method: string; params: Record<string, unknown> }
  | { kind: "notification"; method: string; params: Record<string, unknown> }
  | { kind: "response"; id: string | number; error?: string; result?: unknown }
  | { kind: "invalid" };

function validId(id: unknown): id is string | number {
  return (
    (typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH) ||
    (typeof id === "number" && Number.isSafeInteger(id))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Classifies a message; unknown methods and malformed shapes are `invalid`. */
export function parseProviderMessage(data: unknown): ParsedMessage {
  if (!isRecord(data) || data.jsonrpc !== "2.0") {
    return { kind: "invalid" };
  }
  const params = data.params === undefined ? {} : data.params;
  if (!isRecord(params)) {
    return { kind: "invalid" };
  }
  if (typeof data.method === "string") {
    if (data.id !== undefined) {
      return validId(data.id) && PROVIDER_REQUESTS.has(data.method)
        ? { kind: "request", id: data.id, method: data.method, params }
        : validId(data.id)
          ? { kind: "request", id: data.id, method: "", params }
          : { kind: "invalid" };
    }
    return PROVIDER_NOTIFICATIONS.has(data.method)
      ? { kind: "notification", method: data.method, params }
      : { kind: "invalid" };
  }
  if (validId(data.id) && ("result" in data || "error" in data)) {
    const error = isRecord(data.error) ? String(data.error.message ?? "Request failed") : undefined;
    return { kind: "response", id: data.id, error, result: data.result };
  }
  return { kind: "invalid" };
}

export function providerErrorMessage(params: Record<string, unknown>): string {
  const message = typeof params.message === "string" ? params.message.trim() : "";
  return (message || "The provider could not display this document.").slice(
    0,
    MAX_PROVIDER_ERROR_LENGTH,
  );
}
