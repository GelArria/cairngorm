// Crash store singleton - ring buffer + localStorage persistence
import {
  configureCrashStorage,
  loadCrashRecords,
  retainedCrashes,
  saveCrashRecords,
} from "./crash-persistence";

export type CrashKind = "render" | "async" | "invoke" | "event" | "rust" | "global";

export interface CrashRecord {
  id: string;
  module: string;
  kind: CrashKind;
  message: string;
  stack: string;
  componentStack?: string;
  timestamp: number;
  recovered: boolean;
}

export interface CrashStat {
  module: string;
  total: number;
  byKind: Record<CrashKind, number>;
  lastCrash: number;
}

const MAX_RECORDS = 100;

const records: CrashRecord[] = [];
const subscribers = new Set<() => void>();
let _seq = 0;
let _isRecording = false; // guard against recursive crash logging
let storageLoaded = false;

function uid(): string {
  return `c${++_seq}_${Date.now().toString(36)}`;
}

function pruneRecords(): boolean {
  const retained = retainedCrashes(records).slice(-MAX_RECORDS);
  if (retained.length === records.length) {
    return false;
  }
  records.splice(0, records.length, ...retained);
  return true;
}

function persist(): void {
  pruneRecords();
  saveCrashRecords(records);
}

/** Apply native policy before restoring any persisted diagnostic records. */
export function configureCrashPersistence(policy: {
  persistScrollback: boolean;
  retentionDays: number;
}): void {
  configureCrashStorage(policy);
  if (!storageLoaded) {
    records.unshift(...loadCrashRecords());
    storageLoaded = true;
  }
  _seq = records.reduce(
    (max, record) => Math.max(max, parseInt(record.id.slice(1).split("_")[0]) || 0),
    _seq,
  );
  persist();
  notify();
}

function notify(): void {
  subscribers.forEach((cb) => {
    try {
      cb();
    } catch {
      /* subscriber error */
    }
  });
}

export function recordCrash(
  module: string,
  kind: CrashKind,
  error: Error | string,
  componentStack?: string,
): void {
  // Guard against recursive crash logging (e.g., if notify() triggers a crash)
  if (_isRecording) {
    return;
  }
  _isRecording = true;

  try {
    let message: string;
    let stack: string;
    if (typeof error === "string") {
      message = error;
      stack = "";
    } else {
      try {
        message = error.message || String(error);
      } catch {
        message = "<unreadable error>";
      }
      try {
        stack = error.stack ?? "";
      } catch {
        stack = "";
      }
    }

    const record: CrashRecord = {
      id: uid(),
      module,
      kind,
      message: message.slice(0, 500),
      stack: stack.slice(0, 2000),
      componentStack: componentStack?.slice(0, 1000),
      timestamp: Date.now(),
      recovered: false,
    };

    records.push(record);
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }
    persist();
    // Defer notify to next tick to avoid synchronous render -> crash -> recordCrash loop
    setTimeout(notify, 0);
  } catch {
    // Last resort: if crash store itself crashes, silently swallow to avoid infinite recursion
  } finally {
    _isRecording = false;
  }
}

/** Returns a shallow copy to prevent external mutation. */
export function getCrashes(): CrashRecord[] {
  if (pruneRecords()) {
    saveCrashRecords(records);
  }
  return records.slice();
}

export function getCrashStats(): CrashStat[] {
  const map = new Map<string, CrashStat>();

  for (const r of getCrashes()) {
    let stat = map.get(r.module);
    if (!stat) {
      stat = {
        module: r.module,
        total: 0,
        byKind: { render: 0, async: 0, invoke: 0, event: 0, rust: 0, global: 0 },
        lastCrash: 0,
      };
      map.set(r.module, stat);
    }
    stat.total++;
    stat.byKind[r.kind]++;
    if (r.timestamp > stat.lastCrash) {
      stat.lastCrash = r.timestamp;
    }
  }

  return [...map.values()].sort((a, b) => b.total - a.total);
}

export function clearCrashes(): void {
  records.length = 0;
  persist();
  notify();
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getCrashCount(): number {
  return getCrashes().length;
}
