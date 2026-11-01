import { afterEach, expect, it, vi } from "vitest";
import { waitFor, within } from "../native/qa-profile.mjs";

afterEach(() => vi.useRealTimers());

it("a pending asynchronous readiness check cannot bypass its deadline", async () => {
  vi.useFakeTimers();
  const pending = waitFor(() => new Promise(() => {}), "readiness deadline", 50);
  const rejected = expect(pending).rejects.toThrow("readiness deadline");
  await vi.advanceTimersByTimeAsync(50);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("an operation deadline reaches finally cleanup even when the operation never settles", async () => {
  vi.useFakeTimers();
  const cleanup = vi.fn();
  const pending = within(new Promise(() => {}), 50, "operation deadline").finally(cleanup);
  const rejected = expect(pending).rejects.toThrow("operation deadline");
  await vi.advanceTimersByTimeAsync(50);
  await rejected;
  expect(cleanup).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("successful operations cancel their deadline and preserve their result", async () => {
  vi.useFakeTimers();
  await expect(within(Promise.resolve("ready"), 50, "late")).resolves.toBe("ready");
  expect(vi.getTimerCount()).toBe(0);
});
