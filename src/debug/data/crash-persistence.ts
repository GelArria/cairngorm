import type { CrashRecord } from "./crash-store";

const STORAGE_KEY = "panel:crash-log";
const MAX_STORAGE = 50;
let enabled: boolean | undefined;
let retentionDays = 7;

export function configureCrashStorage(policy: {
  persistScrollback: boolean;
  retentionDays: number;
}): void {
  enabled = policy.persistScrollback;
  retentionDays = Math.max(1, Math.min(365, policy.retentionDays || 7));
}

export function retainedCrashes(records: CrashRecord[]): CrashRecord[] {
  const now = Date.now();
  const cutoff = now - retentionDays * 86400000;
  return records.filter(
    (record) =>
      record &&
      Number.isFinite(record.timestamp) &&
      record.timestamp >= cutoff &&
      record.timestamp <= now,
  );
}

export function loadCrashRecords(): CrashRecord[] {
  if (!enabled) {
    return [];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }
    return retainedCrashes(parsed)
      .filter(
        (record) =>
          typeof record.id === "string" &&
          typeof record.module === "string" &&
          ["render", "async", "invoke", "event", "rust", "global"].includes(record.kind),
      )
      .slice(-MAX_STORAGE);
  } catch {
    return [];
  }
}

export function saveCrashRecords(records: CrashRecord[]): void {
  if (enabled === undefined) {
    return;
  }
  try {
    if (!enabled) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const trimmed = retainedCrashes(records).slice(-MAX_STORAGE);
    if (trimmed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Crash reporting must remain usable when storage is unavailable or full.
  }
}
