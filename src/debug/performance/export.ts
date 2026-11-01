import { getChunkStats, resetChunkData } from "./chunk-timing";
import { isDebug } from "./debug-mode";
import {
  getAvgFps,
  getCurrentFps,
  getFpsPercentile,
  getMaxFps,
  getMinFps,
  resetFpsData,
} from "./fps";
import { getInvokeStats, resetInvokeData } from "./invoke-tracker";
import {
  getGrowthRateKBps,
  getLeakWarning,
  getMemoryHistory,
  getMemorySnapshot,
  resetMemoryData,
} from "./memory";
import { getComponentStats, getTotalRenders, resetRenderCounts } from "./render-count";
import { getRecords, getViewTimings, resetPerfData } from "./timing";
import { getWebVitals, resetWebVitals } from "./web-vitals";

export function exportPerfData(): object {
  if (!isDebug()) {
    return {};
  }
  return {
    timestamp: new Date().toISOString(),
    webVitals: getWebVitals(),
    transitions: getRecords().slice(0, 50),
    viewTimings: getViewTimings(),
    fps: {
      current: getCurrentFps(),
      average: getAvgFps(),
      min: getMinFps(),
      max: getMaxFps(),
      p5: getFpsPercentile(5),
      p95: getFpsPercentile(95),
    },
    memory: {
      current: getMemorySnapshot(),
      history: getMemoryHistory(),
      growthRateKBps: getGrowthRateKBps(),
      leakWarning: getLeakWarning(),
    },
    renders: {
      total: getTotalRenders(),
      components: getComponentStats().slice(0, 30),
    },
    invokes: getInvokeStats(),
    chunks: getChunkStats(),
  };
}

export function downloadPerfReport(): void {
  if (!isDebug()) {
    return;
  }
  const data = exportPerfData();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `perf-report-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function resetAllPerfData(): void {
  resetPerfData();
  resetMemoryData();
  resetFpsData();
  resetRenderCounts();
  resetInvokeData();
  resetWebVitals();
  resetChunkData();
}
