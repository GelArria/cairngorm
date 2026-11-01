import type { DiagSnapshot, StackSample } from "@/debug/model/types";
import { getInvokeRecords } from "@/debug/performance/invoke-tracker";
import { getMemorySnapshot } from "@/debug/performance/memory";
import { getLastLongtask, getLastLongtaskStack } from "@/debug/performance/timing";
import { isUiStuck } from "./ui-health";

let _activeView = "chat";

// Auto-track active view from app events
if (typeof window !== "undefined") {
  window.addEventListener("app-switch-view", (e: Event) => {
    const view = (e as any).detail as string;
    if (view) {
      _activeView = view;
    }
  });
}

export function setDiagView(view: string) {
  _activeView = view;
}

// ── Stack sampler ───────────────────────────────────────────────────────────
// Captures JS stack traces every 500ms. When a freeze happens, the last
// sample(s) show what code was running before the event loop got stuck.
// The `delayMs` field shows how late the timer fired — large delay = freeze.

const STACK_SAMPLES: StackSample[] = [];
const MAX_SAMPLES = 5;
let _stackInterval: ReturnType<typeof setInterval> | null = null;
let _nextExpected: number = 0;

function startStackSampler(): void {
  if (_stackInterval) {
    return;
  }
  _nextExpected = performance.now();
  _stackInterval = setInterval(() => {
    const now = performance.now();
    const delayMs = Math.max(0, now - _nextExpected);
    // Capture stack: trim to 8 frames to keep payload small
    const raw = new Error().stack ?? "";
    const stack = raw.split("\n").slice(0, 9).join("\n");
    STACK_SAMPLES.push({ time: Date.now(), delayMs: Math.round(delayMs), stack });
    if (STACK_SAMPLES.length > MAX_SAMPLES) {
      STACK_SAMPLES.shift();
    }
    _nextExpected = performance.now() + 2000;
  }, 2000);
}

export function stopStackSampler(): void {
  if (_stackInterval) {
    clearInterval(_stackInterval);
    _stackInterval = null;
  }
}

export function collectDiagSnapshot(): DiagSnapshot {
  const mem = getMemorySnapshot();
  const recentInvokes = getInvokeRecords()
    .slice(0, 10)
    .map((r) => `${r.command} ${r.durationMs.toFixed(0)}ms${r.success ? "" : " ERR"}`);

  // Include the last long task stack if available
  const longtaskStack = getLastLongtaskStack();
  if (longtaskStack && STACK_SAMPLES.length > 0) {
    const ltSample: StackSample = {
      time: Date.now(),
      delayMs: 0,
      stack: `LongTask: ${longtaskStack}`,
    };
    return {
      timestamp: new Date().toISOString(),
      activeView: _activeView,
      heapMb: mem ? Math.round(mem.usedJsHeapSize / 1024 / 1024) : 0,
      lastLongtask: getLastLongtask(),
      recentInvokes,
      longTaskCount: 0,
      rssMb: mem ? Math.round(mem.rssMb) : 0,
      uiStuck: isUiStuck(),
      lastJsStacks: [...STACK_SAMPLES, ltSample],
    };
  }

  return {
    timestamp: new Date().toISOString(),
    activeView: _activeView,
    heapMb: mem ? Math.round(mem.usedJsHeapSize / 1024 / 1024) : 0,
    lastLongtask: getLastLongtask(),
    recentInvokes,
    longTaskCount: 0,
    rssMb: mem ? Math.round(mem.rssMb) : 0,
    uiStuck: isUiStuck(),
    lastJsStacks: STACK_SAMPLES.length > 0 ? [...STACK_SAMPLES] : [],
  };
}

// Start sampler immediately (idempotent)
startStackSampler();
