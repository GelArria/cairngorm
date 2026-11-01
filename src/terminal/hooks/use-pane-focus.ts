import { useEffect, useLayoutEffect } from "preact/compat";
import { getTerm } from "../runtime/term-registry";
import { useTerminalTabs } from "./use-terminal-tabs";

import type { RefObject } from "preact";
interface PaneFocusOptions {
  workspace: ReturnType<typeof useTerminalTabs>;
  areaRef: RefObject<HTMLDivElement>;
  zoomedTabId: string | null;
  setZoomedTabId: (id: string | null) => void;
}
export function usePaneFocus({
  workspace,
  areaRef,
  zoomedTabId,
  setZoomedTabId,
}: PaneFocusOptions) {
  const { state, inlineTabs } = workspace;
  // A tab click focuses its terminal, not a hidden/background textarea.
  useEffect(() => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    const term = tab && !tab.kind ? getTerm(tab.sessionId) : undefined;
    if (
      document.activeElement?.getAttribute("role") !== "tab" &&
      term?.element?.offsetParent !== null
    ) {
      term?.focus();
    }
  }, [state.activeTabId]);

  // Zoom resets when switching groups or if the closed tab was the zoomed one
  useEffect(() => {
    setZoomedTabId(null);
  }, [state.activeGroupId]);
  useEffect(() => {
    const shown = state.layout?.cells.some((c) => c.tabId === zoomedTabId);
    if (zoomedTabId && (!shown || !inlineTabs.some((t) => t.id === zoomedTabId))) {
      setZoomedTabId(null);
    }
  }, [inlineTabs, zoomedTabId, state.layout]);
  useLayoutEffect(() => {
    if (!zoomedTabId) {
      return;
    }
    const h = (e: KeyboardEvent) => {
      if (
        !areaRef.current ||
        areaRef.current.offsetParent === null ||
        e.key !== "Escape" ||
        e.defaultPrevented ||
        e.isComposing ||
        document.querySelector('[role="dialog"], [role="menu"]')
      ) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      setZoomedTabId(null);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [zoomedTabId]);
}
