import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SearchBatch, SearchMatch } from "@/common/filesystem/fs-bridge";

let onBatch: (b: SearchBatch) => void = () => {};
const searchFiles = vi.fn();

vi.mock("@/common/filesystem/fs-bridge", () => ({
  searchFiles: (...a: unknown[]) => searchFiles(...a),
  cancelSearch: vi.fn().mockResolvedValue(undefined),
  refreshSearchIndex: vi.fn().mockResolvedValue(0),
  onSearchBatch: vi.fn(async (cb: (b: SearchBatch) => void) => {
    onBatch = cb;
    return () => {};
  }),
}));

const hit = (path: string, line: number): SearchMatch => ({
  path,
  line,
  col: 1,
  lineText: "foo",
  matchStart: 0,
  matchEnd: 3,
  contextBefore: [],
  contextAfter: [],
});

async function freshStore() {
  vi.resetModules();
  const store = await import("@/search/data/search-store");
  const api = await import("@/search/hooks/use-global-search");
  api.setGlobalSearchRootPath("C:\\proj");
  return { store, api };
}

/** Runs the debounced search; returns the batch id the store passed to Rust. */
async function search(api: Awaited<ReturnType<typeof freshStore>>["api"], q: string) {
  api.setGlobalSearchQuery(q);
  await vi.advanceTimersByTimeAsync(200);
  return searchFiles.mock.calls.at(-1)![8] as string;
}

describe("search store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchFiles.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("accepts a batch that lands before the invoke resolves", async () => {
    const { store, api } = await freshStore();
    searchFiles.mockImplementation((...a: unknown[]) => {
      onBatch({ batchId: a[8] as string, matches: [hit("a.ts", 1)], done: false }); // emitted mid-invoke
      return new Promise(() => {}); // never resolves
    });
    await search(api, "foo");
    await vi.advanceTimersByTimeAsync(50);
    expect(store.getState().results).toHaveLength(1);
  });

  it("coalesces a burst of batches into one render and finishes on done", async () => {
    const { store, api } = await freshStore();
    searchFiles.mockResolvedValue("x");
    const id = await search(api, "foo");
    const renders = vi.fn();
    store.listeners.add(renders);
    for (let i = 0; i < 10; i++)
      onBatch({ batchId: id, matches: [hit(`f${i}.ts`, i)], done: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(renders).toHaveBeenCalledTimes(1);
    expect(store.getState().results).toHaveLength(10);

    onBatch({ batchId: id, matches: [], done: true });
    expect(store.getState().loading).toBe(false);
    expect(store.getState().results).toHaveLength(10);
    store.listeners.delete(renders);
  });

  it("ignores batches from a superseded run", async () => {
    const { store, api } = await freshStore();
    searchFiles.mockResolvedValue("x");
    const old = await search(api, "foo");
    await search(api, "food");
    onBatch({ batchId: old, matches: [hit("stale.ts", 1)], done: true });
    await vi.advanceTimersByTimeAsync(50);
    expect(store.getState().results).toHaveLength(0);
    expect(store.getState().loading).toBe(true);
  });

  it("shows the full cached result set on a repeat query, then replaces it", async () => {
    const { store, api } = await freshStore();
    searchFiles.mockResolvedValue("x");
    let id = await search(api, "foo");
    onBatch({ batchId: id, matches: [hit("a.ts", 1)], done: false });
    await vi.advanceTimersByTimeAsync(50);
    onBatch({ batchId: id, matches: [hit("b.ts", 2)], done: true });

    await search(api, "other");
    id = await search(api, "foo");
    expect(store.getState().results.map((r) => r.path)).toEqual(["a.ts", "b.ts"]); // whole set, not the first batch
    onBatch({ batchId: id, matches: [hit("c.ts", 3)], done: false });
    await vi.advanceTimersByTimeAsync(50);
    expect(store.getState().results.map((r) => r.path)).toEqual(["a.ts", "b.ts"]); // no full → partial flicker
    onBatch({ batchId: id, matches: [hit("d.ts", 4)], done: true });
    expect(store.getState().results.map((r) => r.path)).toEqual(["c.ts", "d.ts"]);
  });
});
