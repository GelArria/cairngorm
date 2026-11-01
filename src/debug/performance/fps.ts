import { isDebug } from "./debug-mode";
import type { FpsSample } from "./types";

const samples: FpsSample[] = [];
const MAX_SAMPLES = 300;
let rafId = 0;
let lastTime = 0;
let running = false;
let paused = false;
const onVisibilityChange = () => {
  paused = document.hidden;
};

function fpsLoop(timestamp: number): void {
  if (!running) {
    return;
  }
  if (paused) {
    rafId = requestAnimationFrame(fpsLoop);
    return;
  }
  if (lastTime > 0) {
    const delta = timestamp - lastTime;
    const fps = delta > 0 ? 1000 / delta : 0;
    samples.push({ time: timestamp, fps });
    if (samples.length > MAX_SAMPLES) {
      samples.shift();
    }
  }
  lastTime = timestamp;
  rafId = requestAnimationFrame(fpsLoop);
}

export function startFpsCounter(): void {
  if (running || !isDebug()) {
    return;
  }
  running = true;
  lastTime = 0;
  paused = document.hidden;
  rafId = requestAnimationFrame(fpsLoop);

  // Pause when tab is hidden to avoid wasted cycles
  document.addEventListener("visibilitychange", onVisibilityChange);
}

export function stopFpsCounter(): void {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
  }
  rafId = 0;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

export function getFpsSamples(): FpsSample[] {
  return samples;
}

export function getCurrentFps(): number {
  if (samples.length === 0) {
    return 0;
  }
  return samples[samples.length - 1]?.fps ?? 0;
}

export function getAvgFps(): number {
  if (samples.length === 0) {
    return 0;
  }
  const sum = samples.reduce((a, s) => a + s.fps, 0);
  return sum / samples.length;
}

export function getMinFps(): number {
  if (samples.length === 0) {
    return 0;
  }
  return Math.min(...samples.map((s) => s.fps));
}

export function getMaxFps(): number {
  if (samples.length === 0) {
    return 0;
  }
  return Math.max(...samples.map((s) => s.fps));
}

export function getFpsPercentile(pct: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = samples.map((s) => s.fps).sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * (pct / 100));
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

export function resetFpsData(): void {
  samples.length = 0;
}
