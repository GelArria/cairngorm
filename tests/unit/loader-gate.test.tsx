import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/preact";
import { useLoaderGate, SHOW_AFTER, MIN_VISIBLE } from "@/common/branding//loader-gate";

const mount = () =>
  renderHook(({ loading }) => useLoaderGate(loading), { initialProps: { loading: true } });

describe("useLoaderGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("never shows the loader for a load faster than SHOW_AFTER", async () => {
    const h = mount();
    await act(() => vi.advanceTimersByTimeAsync(SHOW_AFTER - 50));
    expect(h.result.current).toBe(false);
    h.rerender({ loading: false });
    await act(() => vi.advanceTimersByTimeAsync(SHOW_AFTER * 2));
    expect(h.result.current).toBe(false);
  });

  it("keeps a shown loader for MIN_VISIBLE even when the load ends right away", async () => {
    const h = mount();
    await act(() => vi.advanceTimersByTimeAsync(SHOW_AFTER + 10));
    expect(h.result.current).toBe(true);
    h.rerender({ loading: false });
    await act(() => vi.advanceTimersByTimeAsync(MIN_VISIBLE - 100));
    expect(h.result.current).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(h.result.current).toBe(false);
  });

  it("hides as soon as the load ends when it already ran past MIN_VISIBLE", async () => {
    const h = mount();
    await act(() => vi.advanceTimersByTimeAsync(SHOW_AFTER + MIN_VISIBLE + 500));
    h.rerender({ loading: false });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(h.result.current).toBe(false);
  });
});
