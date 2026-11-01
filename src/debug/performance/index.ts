import { useEffect, useRef } from "preact/hooks";
import { startChunkTracking, stopChunkTracking } from "./chunk-timing";
import { detectDebugMode, isDebug } from "./debug-mode";
import { stopHeavyPerfModules } from "./heavy-init";
import { startInvokeTracking, stopInvokeTracking } from "./invoke-tracker";
import { getJsHeapUsed, refreshRustStats, startMemoryTracking, stopMemoryTracking } from "./memory";
import { recordTransition, startObservers, stopObservers } from "./timing";
import { startWebVitals } from "./web-vitals";

let initialized = false;
let _rustStatsInterval: ReturnType<typeof setInterval> | null = null;

async function initPerf(): Promise<void> {
  if (initialized) {
    return;
  }
  const debug = await detectDebugMode();
  if (!debug) {
    return;
  }
  initialized = true;
  // Keep lightweight observers active for diagnostics. FPS sampling and vnode
  // render hooks stay lazy until the overlay is opened, so debug builds do not
  // add a permanent requestAnimationFrame loop to the application.
  startObservers();
  startWebVitals();
  startInvokeTracking();
  startChunkTracking();
  startMemoryTracking();
  // Refresh Rust stats periodically (10s interval)
  _rustStatsInterval = setInterval(async () => {
    if (!isDebug()) {
      if (_rustStatsInterval) {
        clearInterval(_rustStatsInterval);
        _rustStatsInterval = null;
      }
      return;
    }
    await refreshRustStats();
  }, 10000);
  await refreshRustStats();
}

export function stopPerfTracking(): void {
  if (_rustStatsInterval) {
    clearInterval(_rustStatsInterval);
    _rustStatsInterval = null;
  }
  stopObservers();
  stopMemoryTracking();
  stopHeavyPerfModules();
  stopChunkTracking();
  stopInvokeTracking();
  initialized = false;
}

export function usePerfTracker(activeView: string): void {
  const prevView = useRef<string>(activeView);
  const initRef = useRef(false);

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      initPerf();
    }
  }, []);

  useEffect(() => {
    if (!isDebug()) {
      return;
    }
    if (prevView.current === activeView) {
      return;
    }

    const memBefore = getJsHeapUsed();
    recordTransition(prevView.current, activeView, memBefore, null);
    prevView.current = activeView;
  }, [activeView]);
}

// Public API
export { getChunkRecords, getChunkStats, resetChunkData } from "./chunk-timing";
export { PerfOverlay } from "./components/overlay";
export { isDebug } from "./debug-mode";
export { downloadPerfReport, exportPerfData, resetAllPerfData } from "./export";
export {
  getAvgFps,
  getCurrentFps,
  getFpsPercentile,
  getMaxFps,
  getMinFps,
  resetFpsData,
} from "./fps";
export { startHeavyPerfModules } from "./heavy-init";
export { getInvokeRecords, getInvokeStats, resetInvokeData } from "./invoke-tracker";
export {
  getGrowthRateKBps,
  getLeakWarning,
  getMemoryHistory,
  getMemorySnapshot,
  resetMemoryData,
} from "./memory";
export {
  getComponentStats,
  getRenderCounts,
  getTotalRenders,
  resetRenderCounts,
} from "./render-count";
export { getRecords, getViewTimings, markViewSwitch, resetPerfData } from "./timing";
export { getWebVitals, resetWebVitals } from "./web-vitals";
