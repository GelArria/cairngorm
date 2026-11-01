import { scrollbackPolicy } from "../runtime/scrollback-policy";
import { nativeStorageAvailable, readStored, writeStored } from "./native-storage";
const PREFIX = "panel-scrollback:";
export const SCROLLBACK_LIMIT = 262_144;
const LEGACY_LIMIT = 20_000;

export function saveScrollback(sessionId: string, data: string): void {
  if (!scrollbackPolicy().persistScrollback) {
    return;
  }
  const limit = nativeStorageAvailable() ? SCROLLBACK_LIMIT : LEGACY_LIMIT;
  try {
    writeStored(PREFIX + sessionId, data.slice(-limit));
    localStorage.setItem(`${PREFIX}${sessionId}:retained-at`, String(Date.now()));
  } catch (error) {
    console.error("[scrollback] could not save history", error);
  }
}
export async function loadScrollback(sessionId: string): Promise<string | undefined> {
  if (!scrollbackPolicy().persistScrollback) {
    return undefined;
  }
  const stamp = Number(localStorage.getItem(`${PREFIX}${sessionId}:retained-at`) ?? 0);
  if (Date.now() - stamp > scrollbackPolicy().retentionDays * 86400000) {
    clearScrollback(sessionId);
    return undefined;
  }
  try {
    return (await readStored(PREFIX + sessionId)) ?? undefined;
  } catch (error) {
    console.error("[scrollback] could not restore history", error);
    try {
      return localStorage.getItem(PREFIX + sessionId) ?? undefined;
    } catch {
      return undefined;
    }
  }
}
export function clearScrollback(sessionId: string): void {
  try {
    writeStored(PREFIX + sessionId, null);
    localStorage.removeItem(`${PREFIX}${sessionId}:retained-at`);
  } catch (error) {
    console.error("[scrollback] could not clear history", error);
  }
}
