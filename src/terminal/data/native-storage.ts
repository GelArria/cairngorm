import { execute, select } from "@/common/storage/db";
import { reportStorageFallback } from "@/common/storage/storage-health";

let native = false;
// Only preload synchronous workspace reads; scrollbacks stay in SQLite, not this cache.
const cache = new Map<string, string | null>();
const pending = new Map<string, () => string | null>();
let timer: ReturnType<typeof setTimeout> | undefined;
let writes: Promise<void> = Promise.resolve();
let lastStamp = 0;
const timestamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));
const stampKey = (key: string) => `${key}:saved-at`;
const legacy = (key: string) => localStorage.getItem(key);

export function nativeStorageAvailable() {
  return native;
}
export function peekStored(key: string): string | null {
  if (pending.has(key)) {
    return pending.get(key)!();
  }
  return cache.has(key) ? cache.get(key)! : legacy(key);
}
export async function initializeStorage(key: string): Promise<void> {
  try {
    const rows = await select<{ value: string | null; updated_at: number }>(
      "SELECT value, updated_at FROM terminal_state WHERE key = ?",
      [key],
    );
    native = true;
    const old = legacy(key);
    const newerLegacy =
      Number(localStorage.getItem(stampKey(key)) ?? 0) > (rows[0]?.updated_at ?? 0);
    const value = !rows.length || newerLegacy ? old : rows[0].value;
    lastStamp = Math.max(lastStamp, rows[0]?.updated_at ?? 0);
    cache.set(key, value);
  } catch (error) {
    native = false;
    reportStorageFallback("terminals", error);
  }
}
export async function readStored(key: string): Promise<string | null> {
  if (!native) {
    return legacy(key);
  }
  if (pending.has(key)) {
    return pending.get(key)!();
  }
  const committed = writes;
  await committed;
  if (writes !== committed) {
    return readStored(key);
  }
  if (pending.has(key)) {
    return pending.get(key)!();
  }
  const rows = await select<{ value: string | null; updated_at: number }>(
    "SELECT value, updated_at FROM terminal_state WHERE key = ?",
    [key],
  );
  if (writes !== committed) {
    return readStored(key);
  }
  if (pending.has(key)) {
    return pending.get(key)!();
  }
  const old = legacy(key);
  lastStamp = Math.max(lastStamp, rows[0]?.updated_at ?? 0);
  const newerLegacy = Number(localStorage.getItem(stampKey(key)) ?? 0) > (rows[0]?.updated_at ?? 0);
  if (!rows.length || newerLegacy) {
    if (old !== null) {
      writeStored(key, old);
    }
    return old;
  }
  return rows[0].value;
}
export function writeStored(key: string, value: string | null | (() => string | null)): void {
  const get = typeof value === "function" ? value : () => value;
  if (!native) {
    const raw = get();
    if (raw === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, raw);
    }
    localStorage.setItem(stampKey(key), String(timestamp()));
    return;
  }
  pending.set(key, get);
  if (timer) {
    return;
  }
  timer = setTimeout(() => {
    timer = undefined;
    void flushStorage().catch((error) => console.error("[storage] save failed", error));
  }, 40);
}
export async function flushStorage(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const batch = [...pending].map(([key, get]) => [key, get(), timestamp()] as const);
  pending.clear();
  if (batch.length) {
    writes = writes
      .catch(() => {})
      .then(async () => {
        try {
          // One SQLite statement is one transaction; newer queued writes never overtake it.
          await execute(
            `INSERT INTO terminal_state (key,value,updated_at) VALUES ${batch.map(() => "(?,?,?)").join(",")}
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
            batch.flat(),
          );
          for (const [key, value] of batch) {
            if (cache.has(key)) {
              cache.set(key, value);
            }
            localStorage.removeItem(key);
            localStorage.removeItem(stampKey(key));
          }
          if (batch.some(([, value]) => value === null)) {
            await execute("DELETE FROM terminal_state WHERE value IS NULL");
          }
        } catch (error) {
          // Keep a timestamped recovery copy; startup prefers it to an older SQLite row.
          try {
            for (const [key, value, stamp] of batch) {
              if (value === null) {
                localStorage.removeItem(key);
              } else {
                localStorage.setItem(key, value);
              }
              localStorage.setItem(stampKey(key), String(stamp));
              if (cache.has(key)) {
                cache.set(key, value);
              }
            }
          } catch (recoveryError) {
            for (const [key, value] of batch) {
              if (!pending.has(key)) {
                pending.set(key, () => value);
              }
            }
            throw recoveryError;
          }
          console.error("[storage] SQLite write failed; recovery copy saved", error);
        }
      });
  }
  await writes;
  if (pending.size) {
    await flushStorage();
  }
}

const closeCleanups = new Set<() => Promise<void>>();
const closeChecks = new Set<() => Promise<boolean>>();
export function registerStorageCloseCheck(check: () => Promise<boolean>) {
  closeChecks.add(check);
  return () => {
    closeChecks.delete(check);
  };
}
export function registerStorageCloseCleanup(cleanup: () => Promise<void>) {
  closeCleanups.add(cleanup);
  return () => {
    closeCleanups.delete(cleanup);
  };
}

export async function installStorageCloseGuard({
  beforeDestroy,
  onCloseAborted,
  keepRunning,
}: {
  beforeDestroy?: () => Promise<void>;
  onCloseAborted?: () => Promise<void>;
  /** Puts the window away instead of closing it; true when it did. */
  keepRunning?: () => Promise<boolean>;
} = {}): Promise<void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const windowHandle = getCurrentWindow();
  let closing = false;
  const unlisten = await windowHandle.onCloseRequested(async (event) => {
    event.preventDefault();
    if (closing) {
      return;
    }
    closing = true;
    try {
      if (keepRunning && (await keepRunning())) {
        // Still running, only hidden: save now in case the session ends without a window.
        closing = false;
        window.dispatchEvent(new Event("terminal-persist-flush"));
        window.dispatchEvent(new Event("terminal-save-scrollback"));
        await flushStorage().catch((error) =>
          console.error("[storage] background save failed", error),
        );
        return;
      }
      for (const check of closeChecks) {
        if (!(await check())) {
          closing = false;
          await onCloseAborted?.();
          return;
        }
      }
      window.dispatchEvent(new Event("terminal-persist-flush"));
      window.dispatchEvent(new Event("terminal-save-scrollback"));
      await flushStorage();
      for (const cleanup of closeCleanups) {
        await cleanup();
      }
      await beforeDestroy?.();
      await windowHandle.destroy();
      unlisten();
    } catch (error) {
      closing = false;
      console.error("[storage] close blocked because cleanup or persistence failed", error);
      await onCloseAborted?.().catch((cause) =>
        console.error("[storage] close recovery failed", cause),
      );
    }
  });
}
