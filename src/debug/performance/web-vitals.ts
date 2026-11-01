import { isDebug } from "./debug-mode";
import type { WebVitalsSnapshot } from "./types";

let _lcp: number | null = null;
let _fid: number | null = null;
let _inp: number | null = null;
let _cls = 0;
let _ttfb: number | null = null;

let _lcpObserver: PerformanceObserver | null = null;
let _fidObserver: PerformanceObserver | null = null;
let _inpObserver: PerformanceObserver | null = null;
let _clsObserver: PerformanceObserver | null = null;

export function startWebVitals(): void {
  if (!isDebug()) {
    return;
  }

  // LCP — Largest Contentful Paint
  try {
    _lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length > 0) {
        _lcp = entries[entries.length - 1]!.startTime;
      }
    });
    _lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* not supported */
  }

  // FID — First Input Delay
  try {
    _fidObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if ((entry as any).processingStart && entry.startTime) {
          _fid = (entry as any).processingStart - entry.startTime;
        }
      }
    });
    _fidObserver.observe({ type: "first-input", buffered: true });
  } catch {
    /* not supported */
  }

  // INP — Interaction to Next Paint (event-timing with duration)
  try {
    _inpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = (entry as any).duration;
        if (typeof duration === "number" && (_inp === null || duration > _inp)) {
          _inp = duration;
        }
      }
    });
    _inpObserver.observe({ type: "event", buffered: true });
  } catch {
    /* not supported */
  }

  // CLS — Cumulative Layout Shift (from layout-shift entries)
  try {
    _clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          _cls += (entry as any).value ?? 0;
        }
      }
    });
    _clsObserver.observe({ type: "layout-shift", buffered: true });
  } catch {
    /* not supported */
  }

  // TTFB — Time to First Byte
  try {
    const navEntries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (navEntries.length > 0 && navEntries[0]!.responseStart > 0) {
      _ttfb = navEntries[0]!.responseStart;
    } else {
      // Legacy fallback
      const timing = (performance as any).timing;
      if (timing && timing.responseStart && timing.navigationStart) {
        _ttfb = timing.responseStart - timing.navigationStart;
      }
    }
  } catch {
    /* not available */
  }
}

export function stopWebVitals(): void {
  _lcpObserver?.disconnect();
  _lcpObserver = null;
  _fidObserver?.disconnect();
  _fidObserver = null;
  _inpObserver?.disconnect();
  _inpObserver = null;
  _clsObserver?.disconnect();
  _clsObserver = null;
}

export function getWebVitals(): WebVitalsSnapshot {
  return {
    lcp: _lcp,
    fid: _fid,
    inp: _inp,
    cls: _cls,
    ttfb: _ttfb,
  };
}

export function resetWebVitals(): void {
  _lcp = null;
  _fid = null;
  _inp = null;
  _cls = 0;
  _ttfb = null;
}
