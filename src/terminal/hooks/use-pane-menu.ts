import { useCallback, useEffect, useState } from "preact/compat";
import { type PaneEdit } from "../components/terminal-pane-context-menu";
import { getTerm } from "../runtime/term-registry";
import type { ChatViewMode } from "../shared/agent-events";
import { useTerminalTabs } from "./use-terminal-tabs";

export function usePaneMenu(
  state: ReturnType<typeof useTerminalTabs>["state"],
  paneModeOf: (id: string) => ChatViewMode,
) {
  const [paneMenu, setPaneMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  /** Copy / Paste / Select All / Clear for a real terminal pane (not file panes or Chat UI). */
  const paneEdit = (tabId: string): PaneEdit | undefined => {
    const tab = state.tabs.find((t) => t.id === tabId);
    const term =
      tab && !tab.kind && paneModeOf(tabId) === "tui" ? getTerm(tab.sessionId) : undefined;
    if (!term) {
      return undefined;
    }
    return {
      canCopy: term.hasSelection(),
      onCopy: () => {
        void navigator.clipboard?.writeText(term.getSelection())?.catch(() => {});
        term.focus();
      },
      onPaste: () => {
        void navigator.clipboard
          ?.readText()
          ?.then((t) => {
            if (t) {
              term.paste(t);
            }
          })
          .catch(() => {});
        term.focus();
      },
      onSelectAll: () => {
        term.selectAll();
        term.focus();
      },
      onClear: () => {
        term.clear();
        term.focus();
      },
    };
  };

  // ── Pane / tab right-click menu ──
  const openPaneMenu = useCallback((tabId: string, e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    // Opens over mouse-aware TUIs too: the pane withholds the right button from them.
    setPaneMenu({ tabId, x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
  }, []);

  // The menu must not outlive its pane (closed via hotkey/× behind the menu)
  useEffect(() => {
    if (paneMenu && !state.tabs.some((t) => t.id === paneMenu.tabId)) {
      setPaneMenu(null);
    }
  }, [state.tabs, paneMenu]);

  return { paneMenu, setPaneMenu, paneEdit, openPaneMenu };
}
