import { recordCrash } from "@/debug/data/crash-store";
import { collectDiagSnapshot } from "@/debug/data/diag-collector";
import { classifyRejection } from "@/debug/model/rejection-severity";
import type { CrashReport } from "@/debug/model/types";
import { useCallback, useEffect, useState } from "preact/hooks";

export function useCrashCapture() {
  const [report, setReport] = useState<CrashReport | null>(null);

  const addReport = useCallback((r: CrashReport) => {
    console.error("╔═══ CRASH ═══╗", r.source, r.message, r.stacktrace);
    setReport(r);
  }, []);

  useEffect(() => {
    // ── Monkeypatch Tauri invoke to log failures ──
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string, args?: Record<string, unknown>, options?: unknown) => unknown;
          __crashPatched?: boolean;
        };
      }
    ).__TAURI_INTERNALS__;
    let origInvoke:
      | ((cmd: string, args?: Record<string, unknown>, options?: unknown) => unknown)
      | null = null;
    if (internals && typeof internals.invoke === "function" && !internals.__crashPatched) {
      origInvoke = internals.invoke;
      const patchedInvoke = function (
        cmd: string,
        args?: Record<string, unknown>,
        options?: unknown,
      ) {
        const result = origInvoke!.call(internals, cmd, args, options);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return (result as Promise<unknown>).then(
            (val: unknown) => val,
            (err: unknown) => {
              recordCrash(
                "invoke",
                "invoke",
                err instanceof Error ? err : new Error(`${cmd}: ${String(err)}`),
              );
              if (err && typeof err === "object") {
                try {
                  (err as Record<string, unknown>).__crashLogged = true;
                } catch {
                  /* */
                }
              }
              throw err;
            },
          );
        }
        return result;
      };
      try {
        Object.defineProperty(internals, "invoke", { value: patchedInvoke, configurable: true });
        Object.defineProperty(internals, "__crashPatched", { value: true, configurable: false });
      } catch {
        /* cannot patch */
      }
    }

    // ── Heartbeat for Rust watchdog ──
    let hbInterval: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        // Snapshot ALWAYS complete: the empty stub (5 out of 6 beats) left
        // the watchdog without lastJsStacks/recentInvokes right during a freeze.
        hbInterval = setInterval(() => {
          const snapshot = collectDiagSnapshot();
          invoke("heartbeat", { snapshot }).catch(() => {});
        }, 5000);
      } catch {
        /* not in Tauri */
      }
    })();

    // Listen for Rust panics via Tauri event — also log to crash store
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<CrashReport>("app-crash", (e) => {
          recordCrash("rust", "rust", new Error(e.payload.message), e.payload.stacktrace);
          addReport(e.payload);
        });
      } catch {
        /* not in Tauri */
      }
    })();

    // JS errors
    const onError = (e: ErrorEvent) => {
      recordCrash("global", "global", e.error ?? new Error(e.message));
      // Browser layout notifications defer delivery to the next frame; they are not fatal JS errors.
      if (
        e.message === "ResizeObserver loop completed with undelivered notifications." ||
        e.message === "ResizeObserver loop limit exceeded"
      ) {
        console.warn("[resize-observer]", e.message);
        return;
      }
      addReport({
        source: "js",
        message: e.message,
        location: `${e.filename}:${e.lineno}:${e.colno}`,
        stacktrace: e.error?.stack ?? "",
        timestamp: new Date().toISOString(),
      });
    };

    // Unhandled rejections — classify severity: only structural failures
    // (chunks, logic errors) show the modal. IPC/network/timing errors
    // stay in console + the overlay Crashes tab without blocking the UI.
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      recordCrash("global", "async", reason instanceof Error ? reason : new Error(String(reason)));
      const severity = classifyRejection(reason);
      if (severity === "log") {
        console.warn("[rejection-log]", reason instanceof Error ? reason.message : reason);
        return;
      }
      addReport({
        source: "unhandledrejection",
        message: String(reason?.message ?? reason),
        location: "",
        stacktrace: reason?.stack ?? String(reason),
        timestamp: new Date().toISOString(),
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      // Restore original invoke (for HMR / tests)
      if (origInvoke && internals) {
        try {
          Object.defineProperty(internals, "invoke", { value: origInvoke, configurable: true });
          Object.defineProperty(internals, "__crashPatched", { value: false, configurable: true });
        } catch {
          /* */
        }
      }
      unlisten?.();
      if (hbInterval) {
        clearInterval(hbInterval);
      }
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [addReport]);
  return { report, addReport };
}
