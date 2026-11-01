import { getAppearancePalette, subscribeAppearance } from "@/appearance/data/store";
import { claimPluginInput } from "@/plugins/data/plugin-store";
import { ViewHost } from "@/plugins/data/view-host";
import type { PluginCallState } from "@/plugins/model/types";
import { errorMessage } from "@/common/errors";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export interface PluginViewControls {
  ready: boolean;
  preparingReload: boolean;
  prepareReload: () => Promise<boolean>;
}

const theme = () => (getAppearancePalette().dark ? "dark" : "light");

export function usePluginView({ state }: { state: PluginCallState }) {
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const host = useRef<ViewHost | null>(null);
  const [ready, setReady] = useState(false);
  const [preparingReload, setPreparingReload] = useState(false);
  const [reloadError, setReloadError] = useState("");
  const { call } = state;
  const prepareReload = useCallback(async () => {
    if (!host.current) {
      return false;
    }
    setPreparingReload(true);
    setReloadError("");
    try {
      await host.current.prepareReload();
      return true;
    } catch (error) {
      setReloadError(
        `Could not reload view. The current view has been kept. ${errorMessage(error)}`,
      );
      return false;
    } finally {
      setPreparingReload(false);
    }
  }, [call.id]);

  useEffect(() => {
    const element = frame.current!;
    const size = () => ({
      width: container.current?.clientWidth ?? 0,
      height: container.current?.clientHeight ?? 0,
    });
    const view = new ViewHost({
      call,
      frame: element,
      deliverInput: claimPluginInput(call.id),
      onInitialized: () => setReady(true),
      hostContext: () => ({
        toolInfo: { id: call.id, tool: call.tool },
        theme: theme(),
        containerDimensions: size(),
        locale: navigator.language,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userAgent: "Cairngorm",
        platform: "desktop",
        deviceCapabilities: { touch: navigator.maxTouchPoints > 0, hover: true },
      }),
    });
    host.current = view;
    // Load only once the host listens, so the view's first message is never missed.
    element.src = call.viewUrl;
    let timer = 0;
    const resize = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => view.contextChanged({ containerDimensions: size() }), 150);
    });
    resize.observe(container.current!);
    const stopTheme = subscribeAppearance(() => view.contextChanged({ theme: theme() }));
    return () => {
      window.clearTimeout(timer);
      resize.disconnect();
      stopTheme();
      view.dispose();
      host.current = null;
    };
  }, [call.id]);

  useEffect(() => {
    if (state.status !== "running") {
      host.current?.finish(state.result, state.error);
    }
  }, [state.status, state.result, state.error]);

  const clipboard = call.view?.permissions?.clipboardWrite ? "clipboard-write" : undefined;
  return { container, frame, ready, call, clipboard, preparingReload, reloadError, prepareReload };
}
