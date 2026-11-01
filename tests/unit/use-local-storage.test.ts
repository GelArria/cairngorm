import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLocalStorage } from "@/common/hooks/use-local-storage";
import { renderHook, act } from "@testing-library/preact";

function createLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    _store: store,
  };
}

describe("useLocalStorage", () => {
  const mock = createLocalStorageMock();

  beforeEach(() => {
    mock.clear();
    vi.stubGlobal("localStorage", mock);
  });

  it("returns initial value when localStorage empty", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", "default"));
    expect(result.current[0]).toBe("default");
  });

  it("reads from localStorage if present", () => {
    mock._store["test-key"] = JSON.stringify("stored");
    const { result } = renderHook(() => useLocalStorage("test-key", "default"));
    expect(result.current[0]).toBe("stored");
  });

  it("writes to localStorage on setValue", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", "initial"));
    act(() => result.current[1]("updated"));
    expect(result.current[0]).toBe("updated");
    expect(JSON.parse(mock._store["test-key"])).toBe("updated");
  });

  it("handles functional updates", () => {
    const { result } = renderHook(() => useLocalStorage("counter", 0));
    act(() => result.current[1]((prev: number) => prev + 1));
    expect(result.current[0]).toBe(1);
    expect(JSON.parse(mock._store["counter"])).toBe(1);
  });
});
