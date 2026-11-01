import { errorMessage } from "@/common/errors";
import { getTerminalTabs, openAppTab, openPluginTab, useTerminalTabs } from "@/terminal/workspace";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "preact/hooks";
import { finishPluginCall, publishPluginCall, retainPluginCalls } from "../data/plugin-store";
import type { PluginCall } from "../model/types";

interface CallResult {
  id: string;
  result?: Record<string, unknown>;
  error?: string;
}

/** Lives in App: a view opens beside its terminal even when that project is inactive. */
export function usePluginMonitor() {
  const { state } = useTerminalTabs({ content: false });
  const referenced = useRef(new Set<string>());
  const reports = useRef<Promise<unknown>>(Promise.resolve());
  const syncReferences = (observed?: string) => {
    // Native calls begin retained; record even intermediate calls coalesced by rendering.
    if (observed) {
      referenced.current.add(observed);
    }
    const ids = new Set(
      getTerminalTabs().flatMap((tab) =>
        tab.kind === "plugin" && tab.pluginCallId ? [tab.pluginCallId] : [],
      ),
    );
    retainPluginCalls([...ids]);
    for (const id of new Set([...referenced.current, ...ids])) {
      if (ids.has(id) === referenced.current.has(id)) {
        continue;
      }
      const event = ids.has(id) ? "retained" : "released";
      reports.current = reports.current
        .then(() => invoke("plugin_view_event", { callId: id, event, payload: null }))
        .catch((error) =>
          console.warn("[plugins] view reference update failed", errorMessage(error)),
        );
    }
    referenced.current = ids;
  };
  useEffect(() => {
    syncReferences();
  }, [state.tabs]);
  useEffect(() => {
    const stops = [
      listen<PluginCall>("plugin-call", ({ payload }) => {
        publishPluginCall(payload);
        if (payload.terminal != null) {
          openPluginTab({
            sessionId: payload.terminal,
            pluginId: payload.plugin,
            pluginName: payload.pluginName,
            callId: payload.id,
          });
        }
        syncReferences(payload.id);
      }),
      // An agent left an application window visible: show it beside its terminal.
      listen<{ terminal: string; app: string; name: string; hwnd: string; title: string }>(
        "app-window-open",
        ({ payload }) => {
          openAppTab({
            sessionId: payload.terminal,
            appId: payload.app,
            appName: payload.name,
            hwnd: payload.hwnd,
            title: payload.title,
          });
        },
      ),
      listen<CallResult>("plugin-call-result", ({ payload }) => {
        finishPluginCall(payload.id, payload.result, payload.error);
      }),
    ];
    return () => {
      stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
    };
  }, []);
}
