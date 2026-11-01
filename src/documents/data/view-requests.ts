// Requests the host sends to a provider view (save, operations) and their replies.
// Every request has a deadline; replies to unknown or finished requests are ignored.

interface Waiting {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ViewRequests {
  private nextId = 1;
  private waiting = new Map<string, Waiting>();

  /** Registers a request and returns its id; `send` posts it to the view. */
  start(method: string, timeoutMs: number, send: (id: string) => void): Promise<unknown> {
    const id = `host-${method}-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("The provider did not answer in time."));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer });
      send(id);
    });
  }

  settle(id: string | number, error: string | undefined, result: unknown) {
    const waiting = typeof id === "string" ? this.waiting.get(id) : undefined;
    if (!waiting) {
      return;
    }
    this.waiting.delete(id as string);
    clearTimeout(waiting.timer);
    if (error !== undefined) {
      waiting.reject(new Error(error));
    } else {
      waiting.resolve(result);
    }
  }

  cancel(reason: string) {
    for (const waiting of this.waiting.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error(reason));
    }
    this.waiting.clear();
  }
}
