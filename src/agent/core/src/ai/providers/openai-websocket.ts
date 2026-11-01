import WebSocket from "ws";

/** Gateway contract: one Chat Completions request; JSON chunks, then [DONE]. */
export async function* websocketChunks(
  endpoint: string,
  apiKey: string,
  payload: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number; headers?: Record<string, string> } = {},
): AsyncGenerator<any> {
  if (options.signal?.aborted) {
    throw new Error("Request was aborted");
  }
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(options.timeoutMs!, 120_000))
    : 60_000;
  const socket = new WebSocket(endpoint, {
    headers: { ...options.headers, Authorization: `Bearer ${apiKey}` },
    followRedirects: false,
    maxPayload: 4 * 1024 * 1024,
    handshakeTimeout: Math.min(timeoutMs, 60_000),
  });
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let error: Error | undefined;
  let bytes = 0;
  const finish = (failure?: Error) => {
    error ??= failure;
    ended = true;
    wake?.();
  };
  const abort = () => {
    finish(new Error("Request was aborted"));
    socket.terminate();
  };
  const timer = setTimeout(() => {
    finish(new Error("WebSocket provider request timed out"));
    socket.terminate();
  }, timeoutMs);
  socket.on("open", () => socket.send(JSON.stringify(payload)));
  socket.on("message", (data) => {
    if (ended) {
      return;
    }
    const text = data.toString();
    bytes += Buffer.byteLength(text);
    if (bytes > 16 * 1024 * 1024 || queue.length >= 1024) {
      finish(new Error("WebSocket provider response exceeded its limit"));
      socket.terminate();
      return;
    }
    if (text === "[DONE]") {
      finish();
      return;
    }
    try {
      const chunk = JSON.parse(text);
      if (chunk.error) {
        finish(new Error("The WebSocket provider reported an error"));
        return;
      }
      queue.push(chunk);
      wake?.();
    } catch {
      finish(new Error("The WebSocket provider sent invalid JSON"));
    }
  });
  socket.on("error", () => finish(new Error("Could not connect to the WebSocket provider")));
  socket.on("close", () => finish());
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) {
      abort();
    }
    while (!ended || queue.length) {
      if (error) {
        throw error;
      }
      if (queue.length) {
        yield queue.shift();
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
    if (error) {
      throw error;
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    socket.terminate();
  }
}
