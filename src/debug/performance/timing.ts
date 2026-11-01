import { isDebug } from "./debug-mode";
import { getJsHeapUsed } from "./memory";
import type { TransitionRecord, ViewTiming } from "./types";

const records: TransitionRecord[] = [];
const viewTimings: Map<string, ViewTiming> = new Map();
const MAX_RECORDS = 200;

let _clickMark = 0;
let _pendingChunkLoad: number | null = null;

// Long task observer
let _longTaskCount = 0;
let _lastLongtask = "";
let _lastLongtaskStack = "";
let _longTaskObserver: PerformanceObserver | null = null;

// Longtask ring buffer with attribution (for diagnosing renderer stalls;
// the battery reads it via bridge: window.__longtasks). Cap 20.
if (typeof window !== "undefined") {
  (window as any).__longtasks = (window as any).__longtasks ?? [];
}

// Layout shift observer
let _layoutShiftCount = 0;
let _layoutShiftScore = 0;
let _layoutShiftObserver: PerformanceObserver | null = null;

export function markViewSwitch(): void {
  if (!isDebug()) {
    return;
  }
  _clickMark = performance.now();
  _longTaskCount = 0;
  _layoutShiftCount = 0;
  _layoutShiftScore = 0;
  _pendingChunkLoad = null;
  try {
    performance.mark("view-switch-start");
  } catch {
    /* */
  }
}

export function setChunkLoadTime(ms: number): void {
  _pendingChunkLoad = ms;
}

export function startObservers(): void {
  if (!isDebug()) {
    return;
  }
  try {
    _longTaskObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        _longTaskCount++;
        _lastLongtask = `${e.duration.toFixed(0)}ms at ${e.startTime.toFixed(0)}ms`;
        // Capture stack trace — shows observer call chain, useful for correlation
        _lastLongtaskStack = new Error().stack?.split("\n").slice(0, 9).join("\n") ?? "";
        // Attribution: which container/script caused the task (via TaskAttribution)
        const attr = (e as any).attribution?.[0];
        const ring = (window as any).__longtasks;
        if (ring) {
          ring.push({
            t: Date.now(),
            dur: Math.round(e.duration),
            start: Math.round(e.startTime),
            container: attr?.containerName ?? "",
            src: attr?.containerSrc ?? "",
            type: attr?.containerType ?? "",
          });
          if (ring.length > 20) {
            ring.shift();
          }
        }
      }
    });
    _longTaskObserver.observe({ type: "longtask", buffered: true });
  } catch {
    /* longtask not supported */
  }

  try {
    _layoutShiftObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!(e as any).hadRecentInput) {
          _layoutShiftCount++;
          _layoutShiftScore += (e as any).value ?? 0;
        }
      }
    });
    _layoutShiftObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    /* layout-shift not supported */
  }
}

export function stopObservers(): void {
  _longTaskObserver?.disconnect();
  _longTaskObserver = null;
  _layoutShiftObserver?.disconnect();
  _layoutShiftObserver = null;
}

export function recordTransition(
  from: string,
  to: string,
  memBefore: number | null,
  _memAfterUnused?: number | null,
): void {
  if (!isDebug()) {
    return;
  }

  const now = performance.now();
  const clickToEffect = _clickMark > 0 ? now - _clickMark : -1;
  _clickMark = 0;

  const viewName = to;
  const chunkLoad = _pendingChunkLoad;
  _pendingChunkLoad = null;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const paintTime = performance.now();
      const effectToPaint = paintTime - now;
      const totalTime = clickToEffect >= 0 ? clickToEffect + effectToPaint : effectToPaint;

      const memAfter = getJsHeapUsed();

      try {
        performance.mark("view-switch-end");
        performance.measure(`view:${from}->${to}`, "view-switch-start", "view-switch-end");
      } catch {
        /* marks may not exist */
      }

      const record: TransitionRecord = {
        from,
        to: viewName,
        timestamp: Date.now(),
        clickToEffect,
        effectToPaint,
        totalTime: Math.max(totalTime, 0),
        longTasks: _longTaskCount,
        layoutShifts: _layoutShiftCount,
        memBefore,
        memAfter,
        chunkLoadTime: chunkLoad,
      };

      records.unshift(record);
      if (records.length > MAX_RECORDS) {
        records.length = MAX_RECORDS;
      }

      const memDelta = memBefore !== null && memAfter !== null ? memAfter - memBefore : 0;

      const existing = viewTimings.get(viewName);
      if (existing) {
        existing.lastVisit = record.totalTime;
        existing.visits++;
        existing.totalTime += record.totalTime;
        existing.longTasks += record.longTasks;
        existing.layoutShifts += record.layoutShifts;
        existing.avgMemDelta =
          existing.avgMemDelta + (memDelta - existing.avgMemDelta) / existing.visits;
      } else {
        viewTimings.set(viewName, {
          view: viewName,
          firstVisit: record.totalTime,
          lastVisit: record.totalTime,
          visits: 1,
          totalTime: record.totalTime,
          longTasks: record.longTasks,
          layoutShifts: record.layoutShifts,
          avgMemDelta: memDelta,
        });
      }

      const chunkInfo = chunkLoad !== null ? ` chunk=${chunkLoad.toFixed(0)}ms` : "";
      console.log(
        `[perf] ${from} -> ${viewName}: click=${clickToEffect.toFixed(0)}ms paint=${effectToPaint.toFixed(0)}ms${chunkInfo} longTasks=${record.longTasks} cls=${record.layoutShifts} mem=${memDelta >= 0 ? "+" : ""}${(memDelta / 1024).toFixed(0)}KB`,
      );
    });
  });
}

export function getRecords(): TransitionRecord[] {
  return records;
}
export function getViewTimings(): ViewTiming[] {
  return [...viewTimings.values()];
}
export function getLayoutShiftScore(): number {
  return _layoutShiftScore;
}
export function getLastLongtask(): string {
  return _lastLongtask;
}
export function getLastLongtaskStack(): string {
  return _lastLongtaskStack;
}

export function resetPerfData(): void {
  records.length = 0;
  viewTimings.clear();
  _clickMark = 0;
  _pendingChunkLoad = null;
  try {
    performance.getEntriesByType("mark").forEach((m) => {
      if (m.name.startsWith("view-switch")) {
        performance.clearMarks(m.name);
      }
    });
    performance.getEntriesByType("measure").forEach((m) => {
      if (m.name.startsWith("view:")) {
        performance.clearMeasures(m.name);
      }
    });
  } catch {
    /* */
  }
}
