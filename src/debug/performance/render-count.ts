import { options } from "preact";
import { isDebug } from "./debug-mode";
import type { ComponentRenderStats } from "./types";

const SLOW_THRESHOLD_MS = 5;

let renderCounts: Map<string, number> = new Map();
let slowRenderCounts: Map<string, number> = new Map();
let componentTimers: Map<string, { totalMs: number; minMs: number; maxMs: number; count: number }> =
  new Map();
let tracking = false;
let totalRenders = 0;
let hooksInstalled = false;
let originalVnode: typeof options.vnode;
let originalDiffed: ((vnode: any) => void) | undefined;
let originalDiff: ((vnode: any) => void) | undefined;

// Batched timing: accumulate then flush periodically to avoid per-vnode overhead
let pendingTimings: Array<{ name: string; duration: number }> = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function flushTimings(): void {
  const batch = pendingTimings;
  pendingTimings = [];
  for (const { name, duration } of batch) {
    if (duration > SLOW_THRESHOLD_MS) {
      slowRenderCounts.set(name, (slowRenderCounts.get(name) ?? 0) + 1);
    }
    const existing = componentTimers.get(name);
    if (existing) {
      existing.count++;
      existing.totalMs += duration;
      if (duration < existing.minMs) {
        existing.minMs = duration;
      }
      if (duration > existing.maxMs) {
        existing.maxMs = duration;
      }
    } else {
      componentTimers.set(name, { totalMs: duration, minMs: duration, maxMs: duration, count: 1 });
    }
  }
}

export function startRenderTracking(): void {
  if (tracking || !isDebug()) {
    return;
  }
  tracking = true;
  hooksInstalled = true;

  // Hook into Preact's vnode creation for render counting (lightweight — just Map increment)
  originalVnode = options.vnode;
  options.vnode = (vnode) => {
    const name =
      (vnode.type as any)?.displayName ||
      (vnode.type as any)?.name ||
      (typeof vnode.type === "string" ? vnode.type : "Anonymous");
    renderCounts.set(name, (renderCounts.get(name) ?? 0) + 1);
    totalRenders++;
    if (originalVnode) {
      originalVnode(vnode);
    }
  };

  // Assign diffed hook ONCE — no re-assignment inside __b to avoid closure chains
  originalDiffed = (options as any).diffed;
  (options as any).diffed = (vnode2: any) => {
    if (originalDiffed) {
      originalDiffed(vnode2);
    }
    // Measure duration using a start time stashed on the vnode by __b
    const start = (vnode2 as any).__perfStart;
    if (start !== undefined) {
      const name =
        (vnode2.type as any)?.displayName ||
        (vnode2.type as any)?.name ||
        (typeof vnode2.type === "string" ? vnode2.type : "Anonymous");
      pendingTimings.push({ name, duration: performance.now() - start });
      (vnode2 as any).__perfStart = undefined;
    }
  };

  originalDiff = (options as any).__b;
  (options as any).__b = (vnode: any) => {
    if (originalDiff) {
      originalDiff(vnode);
    }
    (vnode as any).__perfStart = performance.now();
  };

  // Flush batched timings every 2s instead of processing per-render
  flushTimer = setInterval(flushTimings, 2000);
}

export function stopRenderTracking(): void {
  tracking = false;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushTimings();
  if (!hooksInstalled) {
    return;
  }
  options.vnode = originalVnode;
  if (originalDiffed) {
    (options as any).diffed = originalDiffed;
  } else {
    delete (options as any).diffed;
  }
  if (originalDiff) {
    (options as any).__b = originalDiff;
  } else {
    delete (options as any).__b;
  }
  hooksInstalled = false;
  originalVnode = undefined;
  originalDiffed = undefined;
  originalDiff = undefined;
}

export function getRenderCounts(): Map<string, number> {
  return renderCounts;
}
export function getTotalRenders(): number {
  return totalRenders;
}
export function getSlowRenderCounts(): Map<string, number> {
  return slowRenderCounts;
}
export function getComponentTimers(): Map<
  string,
  { totalMs: number; minMs: number; maxMs: number; count: number }
> {
  return componentTimers;
}

export function getComponentStats(): ComponentRenderStats[] {
  const stats: ComponentRenderStats[] = [];
  for (const [name, renders] of renderCounts) {
    const timer = componentTimers.get(name);
    stats.push({
      name,
      renders,
      slowRenders: slowRenderCounts.get(name) ?? 0,
      totalTimeMs: timer?.totalMs ?? 0,
      avgMs: timer ? timer.totalMs / timer.count : 0,
      minMs: timer?.minMs ?? 0,
      maxMs: timer?.maxMs ?? 0,
    });
  }
  return stats.sort((a, b) => b.renders - a.renders);
}

export function resetRenderCounts(): void {
  renderCounts = new Map();
  slowRenderCounts = new Map();
  componentTimers = new Map();
  totalRenders = 0;
}
