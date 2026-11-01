import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initUiHealth, isUiStuck, stopUiHealth } from "@/debug/data/ui-health";

let frames: Map<number, FrameRequestCallback>;
let requested: number;
let hidden: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  requested = 0;
  hidden = false;
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    requested++;
    frames.set(++id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => frames.delete(n));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  stopUiHealth();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Delivers every pending frame, as a healthy compositor would. */
function render() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((cb) => cb(performance.now()));
}

it("asks for one frame per second instead of keeping a frame loop alive", () => {
  initUiHealth();
  for (let s = 0; s < 30; s++) {
    vi.advanceTimersByTime(1000);
    render();
  }
  expect(requested).toBe(30);
  expect(frames.size).toBe(0);
  expect(isUiStuck()).toBe(false);
});

it("reports a live freeze when frames stop while timers run, then recovers", () => {
  initUiHealth();
  vi.advanceTimersByTime(12_000);
  expect(isUiStuck()).toBe(true);
  expect(requested).toBe(1); // no pile-up of frame requests while stuck
  expect(console.error).toHaveBeenCalledTimes(1);
  render();
  expect(isUiStuck()).toBe(false);
});

it("treats a hidden window as paused, not frozen", () => {
  initUiHealth();
  vi.advanceTimersByTime(1000);
  hidden = true;
  vi.advanceTimersByTime(60_000);
  expect(isUiStuck()).toBe(false);
  expect(frames.size).toBe(0);
  hidden = false;
  vi.advanceTimersByTime(1000);
  render();
  expect(isUiStuck()).toBe(false);
  expect(console.error).not.toHaveBeenCalled();
});

it("stops probing after stopUiHealth", () => {
  initUiHealth();
  vi.advanceTimersByTime(1000);
  stopUiHealth();
  vi.advanceTimersByTime(20_000);
  expect(frames.size).toBe(0);
  expect(isUiStuck()).toBe(false);
});
