import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "preact/hooks";
import { previewAddress } from "../model/preview-address";

type Bounds = { x: number; y: number; width: number; height: number };
type State = { url: string; loading: boolean; opened: boolean; error?: string };
type Action = "open" | "navigate" | "back" | "forward" | "reload" | "layout" | "close";

export function useBrowserPreview() {
  const surface = useRef<HTMLDivElement>(null);
  const id = useRef(crypto.randomUUID());
  const available = isTauri();
  const alive = useRef(false),
    opened = useRef(false);
  const queue = useRef(Promise.resolve<unknown>(undefined));
  const ready = useRef(Promise.resolve());
  const [state, setState] = useState<State>({ url: "", loading: false, opened: false });
  const geometry = () => {
    const el = surface.current,
      rect = el?.getBoundingClientRect();
    const visible =
      !!rect &&
      rect.width > 0 &&
      rect.height > 0 &&
      !document.hidden &&
      getComputedStyle(el!).visibility !== "hidden" &&
      !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]');
    const bounds: Bounds | undefined = visible
      ? {
          x: Math.max(0, rect!.x),
          y: Math.max(0, rect!.y),
          width: Math.max(1, Math.min(rect!.right, innerWidth) - Math.max(0, rect!.x)),
          height: Math.max(1, Math.min(rect!.bottom, innerHeight) - Math.max(0, rect!.y)),
        }
      : undefined;
    return {
      visible:
        visible &&
        rect!.right > 0 &&
        rect!.bottom > 0 &&
        rect!.x < innerWidth &&
        rect!.y < innerHeight,
      bounds,
    };
  };
  const execute = (action: Action, args: Record<string, unknown> = {}) => {
    const result = queue.current
      .catch(() => {})
      .then(() => ready.current)
      .then(() => invoke("test_preview", { previewId: id.current, action, ...args }));
    queue.current = result;
    return result;
  };
  const fail = (error: unknown) => {
    if (alive.current) {
      setState((s) => ({
        ...s,
        loading: false,
        error: String(error instanceof Error ? error.message : error),
      }));
    }
  };
  useEffect(() => {
    alive.current = true;
    if (!available) {
      return () => {
        alive.current = false;
      };
    }
    let stopped = false,
      unlisten: (() => void) | undefined,
      frame = 0,
      previous = "",
      layoutBusy = false,
      pendingLayout: ReturnType<typeof geometry> | null = null;
    ready.current = listen<{ url: string; loading: boolean }>(
      `test-preview-${id.current}`,
      ({ payload }) => {
        if (!stopped) {
          setState((s) => ({ ...s, url: payload.url, loading: payload.loading, error: undefined }));
        }
      },
    ).then((un) => {
      if (stopped) {
        un();
      } else {
        unlisten = un;
      }
    });
    ready.current.catch(fail);
    const sendLayout = (layout: ReturnType<typeof geometry>) => {
      if (!opened.current || stopped) {
        return;
      }
      if (layoutBusy) {
        // Native set_bounds can be slower than a resize gesture. Keep only the
        // newest bounds instead of building an IPC queue of obsolete frames.
        pendingLayout = layout;
        return;
      }
      const key = JSON.stringify(layout);
      if (key === previous) {
        return;
      }
      previous = key;
      layoutBusy = true;
      void execute("layout", layout)
        .catch(fail)
        .finally(() => {
          layoutBusy = false;
          const next = pendingLayout;
          pendingLayout = null;
          if (next) {
            sendLayout(next);
          }
        });
    };
    const update = () => {
      frame = 0;
      if (!opened.current || stopped) {
        return;
      }
      sendLayout(geometry());
    };
    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    const onOverlayKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" ||
        event.key === "Tab" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        schedule();
      }
    };
    const resize = new ResizeObserver(schedule);
    if (surface.current) {
      resize.observe(surface.current);
    }
    // Portaled dialogs/tooltips are direct body children. Inline menus are
    // covered by the pointer/keyboard events below. Avoid observing the whole
    // app: xterm, folds and animations mutate descendants every frame.
    const overlays = new MutationObserver(schedule);
    overlays.observe(document.body, { childList: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("wheel", schedule, { capture: true, passive: true });
    window.addEventListener("blur", schedule);
    window.addEventListener("contextmenu", schedule, true);
    window.addEventListener("mousedown", schedule, true);
    window.addEventListener("click", schedule, true);
    window.addEventListener("keydown", onOverlayKey, true);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      stopped = true;
      alive.current = false;
      unlisten?.();
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      pendingLayout = null;
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("wheel", schedule, true);
      window.removeEventListener("blur", schedule);
      window.removeEventListener("contextmenu", schedule, true);
      window.removeEventListener("mousedown", schedule, true);
      window.removeEventListener("click", schedule, true);
      window.removeEventListener("keydown", onOverlayKey, true);
      document.removeEventListener("visibilitychange", schedule);
      // Serialized after creation/navigation: a late open cannot leave an orphan webview.
      void execute("close").catch(() => {});
      opened.current = false;
    };
  }, []);
  const navigate = async (address: string) => {
    if (!available) {
      return;
    }
    try {
      const url = previewAddress(address),
        layout = geometry();
      if (!layout.visible && !opened.current) {
        throw new Error("Browser panel must be visible before opening a page");
      }
      setState((s) => ({ ...s, loading: true, error: undefined }));
      await execute(opened.current ? "navigate" : "open", { url, ...layout });
      opened.current = true;
      if (alive.current) {
        setState((s) => ({ ...s, opened: true }));
        await execute("layout", geometry());
      }
    } catch (error) {
      fail(error);
    }
  };
  const control = (action: "back" | "forward" | "reload") => {
    if (available && opened.current) {
      void execute(action).catch(fail);
    }
  };
  return { surface, state, available, navigate, control };
}
