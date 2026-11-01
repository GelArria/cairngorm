import { isDebug } from "./debug-mode";
import { startFpsCounter, stopFpsCounter } from "./fps";
import { startRenderTracking, stopRenderTracking } from "./render-count";

let started = false;

/** Start heavy perf modules (FPS counter and render tracking).
 *  Active only while the expanded PerfOverlay is visible. */
export function startHeavyPerfModules(): void {
  if (started || !isDebug()) {
    return;
  }
  started = true;
  startFpsCounter();
  startRenderTracking();
}

/** Stop the expensive sampling hooks while the overlay is collapsed. */
export function stopHeavyPerfModules(): void {
  if (!started) {
    return;
  }
  stopFpsCounter();
  stopRenderTracking();
  started = false;
}
