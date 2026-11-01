import { isDebug } from "./debug-mode";
import { setChunkLoadTime } from "./timing";
import type { ChunkLoadRecord } from "./types";

const records: ChunkLoadRecord[] = [];
const MAX_RECORDS = 100;
let _observer: PerformanceObserver | null = null;

const KNOWN_CHUNKS: Record<string, string> = {
  codemirror: "CodeMirror",
  xterm: "xterm.js",
  calendar: "Calendar",
};

function identifyChunk(url: string): string {
  for (const [pattern, name] of Object.entries(KNOWN_CHUNKS)) {
    if (url.toLowerCase().includes(pattern.toLowerCase())) {
      return name;
    }
  }
  // Extract filename from URL
  const parts = url.split("/");
  const file = parts[parts.length - 1] ?? url;
  return file.replace(/\?.*$/, "").replace(/\.js$/, "");
}

export function startChunkTracking(): void {
  if (!isDebug()) {
    return;
  }

  try {
    _observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if ((entry as any).initiatorType !== "script" && (entry as any).initiatorType !== "link") {
          continue;
        }
        const url = entry.name;
        // Only track app chunks, not external CDN scripts
        if (!url.includes("/assets/") && !url.includes("node_modules")) {
          continue;
        }

        const name = identifyChunk(url);
        const loadTime = entry.duration;
        const transferSize = (entry as any).transferSize ?? (entry as any).encodedBodySize ?? 0;

        records.push({
          name,
          loadTime,
          transferSize,
          timestamp: Date.now(),
        });
        if (records.length > MAX_RECORDS) {
          records.shift();
        }

        // Feed into the current view switch timing if one is in progress
        if (loadTime > 10) {
          setChunkLoadTime(loadTime);
        }
      }
    });
    _observer.observe({ type: "resource", buffered: false });
  } catch {
    /* resource observer not supported */
  }
}

export function stopChunkTracking(): void {
  _observer?.disconnect();
  _observer = null;
}

export function getChunkRecords(): ChunkLoadRecord[] {
  return records;
}

export function getChunkStats(): {
  name: string;
  loads: number;
  avgTime: number;
  lastTime: number;
  avgSize: number;
}[] {
  const map = new Map<string, { times: number[]; sizes: number[] }>();
  for (const r of records) {
    const existing = map.get(r.name);
    if (existing) {
      existing.times.push(r.loadTime);
      existing.sizes.push(r.transferSize);
    } else {
      map.set(r.name, { times: [r.loadTime], sizes: [r.transferSize] });
    }
  }

  const result: {
    name: string;
    loads: number;
    avgTime: number;
    lastTime: number;
    avgSize: number;
  }[] = [];
  for (const [name, data] of map) {
    const totalTime = data.times.reduce((a, b) => a + b, 0);
    const totalSize = data.sizes.reduce((a, b) => a + b, 0);
    result.push({
      name,
      loads: data.times.length,
      avgTime: totalTime / data.times.length,
      lastTime: data.times[data.times.length - 1] ?? 0,
      avgSize: totalSize / data.sizes.length,
    });
  }
  return result.sort((a, b) => b.avgTime - a.avgTime);
}

export function resetChunkData(): void {
  records.length = 0;
}
