export interface ViewTiming {
  view: string;
  firstVisit: number;
  lastVisit: number;
  visits: number;
  totalTime: number;
  longTasks: number;
  layoutShifts: number;
  avgMemDelta: number;
}

export interface TransitionRecord {
  from: string;
  to: string;
  timestamp: number;
  clickToEffect: number;
  effectToPaint: number;
  totalTime: number;
  longTasks: number;
  layoutShifts: number;
  memBefore: number | null;
  memAfter: number | null;
  chunkLoadTime: number | null;
}

export interface InvokeRecord {
  command: string;
  startMs: number;
  durationMs: number;
  success: boolean;
  timestamp: number;
}

export interface InvokeStats {
  command: string;
  calls: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  errors: number;
  errorRate: number;
}

export interface MemorySnapshot {
  usedJsHeapSize: number;
  totalJsHeapSize: number;
  jsHeapSizeLimit: number;
  rssMb: number;
  uptimeSecs: number;
  timestamp: number;
}

export interface FpsSample {
  time: number;
  fps: number;
}

export interface WebVitalsSnapshot {
  lcp: number | null;
  fid: number | null;
  inp: number | null;
  cls: number;
  ttfb: number | null;
}

export interface ChunkLoadRecord {
  name: string;
  loadTime: number;
  transferSize: number;
  timestamp: number;
}

export interface ComponentRenderStats {
  name: string;
  renders: number;
  slowRenders: number;
  totalTimeMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}
