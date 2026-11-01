import { useCallback } from "preact/compat";
import { detachTerminalWindow, focusDetachedWindow } from "../data/terminal-window";
import { DOCUMENT_WINDOW_PREFIX } from "@/documents/api";
import { detachDocumentTab, focusDocumentWindowOrRecover } from "../state/document-window-actions";
import { useTerminalTabs } from "./use-terminal-tabs";

export function useDetachedActions(
  workspace: ReturnType<typeof useTerminalTabs>,
  embedded?: boolean,
) {
  const { state, inlineTabs, detachTab } = workspace;
  // With an active split: the WHOLE grid goes to ONE window, keeping the layout.
  // Without split: the tab alone to its own window (classic behavior).
  // embedded (detached window): detach disabled — avoids grandchildren without reattach.
  const handleDetach = useCallback(
    async (tabId: string) => {
      if (embedded) {
        return;
      }
      const tab = state.tabs.find((t) => t.id === tabId);
      if (tab?.kind === "file" && !tab.detached) {
        // A document always moves alone; the rest of its split stays in main.
        await detachDocumentTab(tab.id);
        return;
      }
      if (!tab || tab.detached || tab.kind) {
        return;
      }
      // Only the split group on screen travels; loose tabs stay in main.
      const inGroup = new Set(state.layout?.cells.map((c) => c.tabId));
      const isSplit = !!state.layout && inGroup.has(tabId);
      const grouped = inlineTabs.filter((t) => inGroup.has(t.id));
      if (isSplit && grouped.some((t) => t.kind)) {
        return;
      }
      const members = isSplit ? grouped : [tab];
      const info = members.map(
        ({ id, sessionId, openedAt, title, shellPath, shellArgs, cwd, isAgent, profile }) => ({
          id,
          sessionId,
          openedAt,
          title,
          shellPath,
          shellArgs,
          cwd,
          isAgent,
          profile,
        }),
      );
      const win = await detachTerminalWindow(info, isSplit ? state.layout : null);
      if (win) {
        for (const m of info) {
          detachTab(m.id, win.label);
        }
      }
    },
    [embedded, state.tabs, state.layout, inlineTabs, detachTab],
  );

  const handleFocusDetached = useCallback(async (windowLabel: string) => {
    if (windowLabel.startsWith(DOCUMENT_WINDOW_PREFIX)) {
      await focusDocumentWindowOrRecover(windowLabel);
      return;
    }
    await focusDetachedWindow(windowLabel);
  }, []);

  return { handleDetach, handleFocusDetached };
}
