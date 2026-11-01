import { isDebug } from "./debug-mode";
import type { MemorySnapshot } from "./types";

interface PerfMemory {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

declare const performance: { memory?: PerfMemory };

let _rustStats = { rssMb: 0, uptimeSecs: 0 };

const history: MemorySnapshot[] = [];
const MAX_HISTORY = 120;
let historyInterval: ReturnType<typeof setInterval> | null = null;

const LEAK_THRESHOLD_KB_PER_S = 100; // 100KB/s sustained growth
const LEAK_MIN_SAMPLES = 6; // need at least ~30s of data at 5s intervals

function captureSnapshot(): MemorySnapshot {
  const mem = performance.memory;
  return {
    usedJsHeapSize: mem?.usedJSHeapSize ?? 0,
    totalJsHeapSize: mem?.totalJSHeapSize ?? 0,
    jsHeapSizeLimit: mem?.jsHeapSizeLimit ?? 0,
    rssMb: _rustStats.rssMb,
    uptimeSecs: _rustStats.uptimeSecs,
    timestamp: Date.now(),
  };
}

export function startMemoryTracking(): void {
  if (historyInterval || !isDebug()) {
    return;
  }
  // Capture initial
  history.push(captureSnapshot());
  // Poll every 10s (reduced from 5s — refreshRustStats is expensive)
  historyInterval = setInterval(() => {
    if (!isDebug()) {
      stopMemoryTracking();
      return;
    }
    const snap = captureSnapshot();
    history.push(snap);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }
  }, 10000);
}

export function stopMemoryTracking(): void {
  if (historyInterval) {
    clearInterval(historyInterval);
    historyInterval = null;
  }
}

export async function refreshRustStats(): Promise<void> {
  if (!isDebug()) {
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const stats = await invoke<{ rssMb: number; uptimeSecs: number }>("get_perf_stats");
    _rustStats = stats;
  } catch {
    /* not in Tauri */
  }
}

export function getMemorySnapshot(): MemorySnapshot | null {
  if (!isDebug()) {
    return null;
  }
  return captureSnapshot();
}

export function getJsHeapUsed(): number | null {
  return performance.memory?.usedJSHeapSize ?? null;
}

export function getRustStats() {
  return _rustStats;
}

export function getMemoryHistory(): MemorySnapshot[] {
  return history;
}

export function getGrowthRateKBps(): number {
  if (history.length < 2) {
    return 0;
  }
  const oldest = history[0];
  const newest = history[history.length - 1];
  const deltaBytes = newest.usedJsHeapSize - oldest.usedJsHeapSize;
  const deltaSecs = (newest.timestamp - oldest.timestamp) / 1000;
  if (deltaSecs <= 0) {
    return 0;
  }
  return deltaBytes / 1024 / deltaSecs;
}

export function getLeakWarning(): boolean {
  if (history.length < LEAK_MIN_SAMPLES) {
    return false;
  }
  return getGrowthRateKBps() > LEAK_THRESHOLD_KB_PER_S;
}

export function resetMemoryData(): void {
  history.length = 0;
}
