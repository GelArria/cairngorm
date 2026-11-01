/**
 * Severity of an unhandled promise rejection.
 *
 * "crash" → shows the Crash Report modal (the UI may be broken).
 * "log"   → only console.error + crash-store (operational error; the UI stays alive).
 *
 * Golden rule: a promise rejection does NOT mean the render tree is
 * broken. Only structural failures (chunks, modules, app logic
 * errors) block the UI. IPC/network/timing errors are
 * operational and are already logged in the overlay's Crashes tab.
 */

export type CrashSeverity = "crash" | "log";

/** Errors that leave the UI structurally broken → modal. */
const FATAL_PATTERNS: RegExp[] = [
  /dynamically imported module/i,
  /importing a module script/i,
  /unable to preload/i,
  /error loading chunk/i,
];

/** Common operational errors → log only. */
const LOG_PATTERNS: RegExp[] = [
  /^command .* not found/i, // Tauri: missing IPC command (mock mode)
  /network error/i,
  /failed to fetch/i,
  /load failed/i,
  /timeout/i,
  /aborted/i, // AbortError and related errors
];

/** Rejections already logged by the invoke monkeypatch (marked __crashLogged). */
function isInvokeRejection(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "__crashLogged" in (reason as Record<string, unknown>)
  );
}

export function classifyRejection(reason: unknown): CrashSeverity {
  // Tauri invoke rejections are already logged as IPC errors; keep the crash modal closed.
  if (isInvokeRejection(reason)) {
    return "log";
  }

  const message =
    reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";

  if (!message) {
    return "log";
  } // null/undefined/objects without message: nothing actionable

  // AbortError and cancellations are part of the normal lifecycle.
  const name = reason instanceof Error ? reason.name : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return "log";
  }

  // Structural failures FIRST (chunk/module loading leaves the view broken)
  // — "Failed to fetch dynamically imported module" contains "failed to fetch"
  // and must win over the operational network pattern.
  for (const p of FATAL_PATTERNS) {
    if (p.test(message)) {
      return "crash";
    }
  }

  // Operational errors (network, timeout, IPC) are logged.
  for (const p of LOG_PATTERNS) {
    if (p.test(message)) {
      return "log";
    }
  }

  // Any other app-logic Error → the UI may be inconsistent
  if (reason instanceof Error) {
    return "crash";
  }

  // Weird strings/objects → we don't know what it is, log it
  return "log";
}
