// Keeps the real application window over its pane and restores it on unmount.
import { errorMessage } from "@/common/errors";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "preact/hooks";

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export function useAppWindowDock(hwnd: string, appId: string, onReopened: (hwnd: string) => void) {
  const area = useRef<HTMLDivElement>(null);
  const [released, setReleased] = useState(false);
  const [closed, setClosed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const mounted = useRef(true);
  const releaseDock = useRef<() => Promise<boolean>>(async () => false);
  const previousRelease = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const element = area.current;
    if (!hwnd || released || !element) {
      return;
    }
    const dockId = crypto.randomUUID();
    const ready = previousRelease.current;
    let disposed = false;
    let dead = false;
    let busy = false;
    let leaving = false;
    let last = "";
    let checkedAt = 0;
    let pending: Promise<void> = Promise.resolve();
    setClosed(false);
    setError("");
    const sync = (focus = false, force = false) => {
      if (disposed || dead || busy || leaving) {
        return;
      }
      const rect = element.getBoundingClientRect();
      const visible =
        element.offsetParent !== null &&
        rect.width > 8 &&
        rect.height > 8 &&
        document.visibilityState === "visible" &&
        !document.querySelector(OVERLAYS);
      const key = [rect.left, rect.top, rect.width, rect.height, visible].join(",");
      // Keep a bounded liveness check even when the pane's geometry is unchanged.
      if (key === last && !focus && !force && Date.now() - checkedAt < 1000) {
        return;
      }
      busy = true;
      last = key;
      checkedAt = Date.now();
      pending = ready
        .then(() => {
          if (disposed) {
            return true;
          }
          return invoke<boolean>("app_window_dock", {
            hwnd,
            dockId,
            x: rect.left,
            y: rect.top,
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
            visible,
            focus,
          });
        })
        .then(
          (alive) => {
            if (!disposed) {
              dead = alive === false;
              setClosed(dead);
              setError("");
            }
          },
          (cause) => {
            if (!disposed) {
              setError(errorMessage(cause));
            }
          },
        )
        .finally(() => {
          busy = false;
        });
    };
    const releaseWindow = async () => {
      leaving = true;
      try {
        await pending;
        await invoke("app_window_release", { hwnd, dockId });
        return !disposed;
      } catch (cause) {
        leaving = false;
        throw cause;
      }
    };
    releaseDock.current = releaseWindow;
    const resize = new ResizeObserver(() => sync());
    resize.observe(element);
    const timer = window.setInterval(() => sync(), 250);
    const win = getCurrentWindow();
    const stops = [
      win.onMoved(() => sync(false, true)),
      win.onResized(() => sync(false, true)),
      win.onScaleChanged(() => sync(false, true)),
    ];
    sync(true);
    return () => {
      disposed = true;
      resize.disconnect();
      window.clearInterval(timer);
      for (const stop of stops) {
        void stop
          .then((unlisten) => unlisten())
          .catch((cause) => console.warn("Application window listener cleanup failed", cause));
      }
      // A → B → A must not reuse A's HWND while its previous lease is still releasing.
      previousRelease.current = releaseWindow()
        .then(() => {})
        .catch((cause) => console.warn("Could not restore application window", cause));
    };
  }, [hwnd, released, attempt]);

  const reopen = async () => {
    if (opening) {
      return;
    }
    setOpening(true);
    setActionError("");
    setError("");
    try {
      const window = await invoke<{ hwnd: string }>("app_window_open", { appId });
      if (mounted.current) {
        onReopened(window.hwnd);
        setReleased(false);
        setAttempt((value) => value + 1);
      }
    } catch (cause) {
      if (mounted.current) {
        setActionError(errorMessage(cause));
      }
    } finally {
      if (mounted.current) {
        setOpening(false);
      }
    }
  };

  return {
    area,
    error: actionError || error,
    released,
    closed,
    opening,
    reopen,
    release: async () => {
      try {
        if (await releaseDock.current()) {
          setActionError("");
          setReleased(true);
        }
      } catch (cause) {
        if (mounted.current) {
          setActionError(errorMessage(cause));
        }
      }
    },
    attach: () => {
      setActionError("");
      setReleased(false);
    },
  };
}
