import { invoke } from "@tauri-apps/api/core";

export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
}

export function startTelemetry() {
  const gaps = [],
    pings = [],
    pending = new Set();
  let frame,
    last = performance.now(),
    active = true;
  const tick = (now) => {
    gaps.push(now - last);
    last = now;
    if (active) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const ping = () => {
    const start = performance.now();
    const work = invoke("bench_ping").then(() => {
      pings.push(performance.now() - start);
    });
    pending.add(work);
    work.finally(() => pending.delete(work));
  };
  const timer = setInterval(ping, 50);
  ping();
  return async () => {
    active = false;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    await Promise.all(pending);
    return {
      frameP95Ms: percentile(gaps, 0.95),
      frameMaxMs: Math.max(0, ...gaps),
      pingP95Ms: percentile(pings, 0.95),
      pingMaxMs: Math.max(0, ...pings),
      frames: gaps.length,
      pings: pings.length,
    };
  };
}
