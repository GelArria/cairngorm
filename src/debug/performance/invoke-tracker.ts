import { isDebug } from "./debug-mode";
import type { InvokeRecord, InvokeStats } from "./types";

const records: InvokeRecord[] = [];
const MAX_RECORDS = 200;
let patched = false;
let _origInvoke:
  | ((cmd: string, args?: Record<string, unknown>, options?: unknown) => unknown)
  | null = null;

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => unknown;
  __TAURI_INTERNALS__?: unknown;
}

export function startInvokeTracking(): void {
  if (patched || !isDebug()) {
    return;
  }

  // Patch Tauri's invoke at the internal level
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: unknown } })
    .__TAURI_INTERNALS__;
  if (!internals) {
    return;
  }

  const origInvoke = internals.invoke;
  if (typeof origInvoke !== "function") {
    return;
  }
  _origInvoke = origInvoke as TauriInternals["invoke"];
  patched = true;

  const patchedInvoke = function (cmd: string, args?: Record<string, unknown>, options?: unknown) {
    const start = performance.now();
    const result = _origInvoke!.call(internals, cmd, args, options);

    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).then(
        (val: unknown) => {
          const duration = performance.now() - start;
          recordInvoke(cmd, start, duration, true);
          return val;
        },
        (err: unknown) => {
          const duration = performance.now() - start;
          recordInvoke(cmd, start, duration, false);
          throw err;
        },
      );
    }

    // Synchronous fallback
    const duration = performance.now() - start;
    recordInvoke(cmd, start, duration, true);
    return result;
  };

  try {
    Object.defineProperty(internals, "invoke", { value: patchedInvoke, configurable: true });
  } catch {
    patched = false;
  }
}

function recordInvoke(
  command: string,
  startMs: number,
  durationMs: number,
  success: boolean,
): void {
  const record: InvokeRecord = {
    command,
    startMs,
    durationMs,
    success,
    timestamp: Date.now(),
  };
  records.unshift(record);
  if (records.length > MAX_RECORDS) {
    records.length = MAX_RECORDS;
  }
}

export function getInvokeRecords(): InvokeRecord[] {
  return records;
}

export function getInvokeStats(): InvokeStats[] {
  const map = new Map<string, { durations: number[]; errors: number }>();
  for (const r of records) {
    const existing = map.get(r.command);
    if (existing) {
      existing.durations.push(r.durationMs);
      if (!r.success) {
        existing.errors++;
      }
    } else {
      map.set(r.command, { durations: [r.durationMs], errors: r.success ? 0 : 1 });
    }
  }

  const stats: InvokeStats[] = [];
  for (const [command, data] of map) {
    const sorted = [...data.durations].sort((a, b) => a - b);
    const total = sorted.reduce((a, b) => a + b, 0);
    const p95Idx = Math.floor(sorted.length * 0.95);
    stats.push({
      command,
      calls: sorted.length,
      totalMs: total,
      avgMs: total / sorted.length,
      minMs: sorted[0] ?? 0,
      maxMs: sorted[sorted.length - 1] ?? 0,
      p95Ms: sorted[Math.min(p95Idx, sorted.length - 1)] ?? 0,
      errors: data.errors,
      errorRate: data.errors / sorted.length,
    });
  }
  return stats.sort((a, b) => b.totalMs - a.totalMs);
}

export function resetInvokeData(): void {
  records.length = 0;
}

export function stopInvokeTracking(): void {
  if (!patched) {
    return;
  }
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: unknown } })
    .__TAURI_INTERNALS__;
  if (internals && _origInvoke) {
    try {
      Object.defineProperty(internals, "invoke", { value: _origInvoke, configurable: true });
    } catch {
      /* cannot restore */
    }
  }
  _origInvoke = null;
  patched = false;
}
