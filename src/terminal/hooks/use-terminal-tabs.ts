import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { activeInline } from "../model/layout/geometry";
import { sameTerminalChrome } from "../model/terminal-chrome";
import { type TerminalState } from "../model/types";
import { detachTab } from "../state/detached-workspace";
import { markFileClean, openFileTab, setActiveTab, updateFileContent } from "../state/file-actions";
import { closeGroup, switchGroup } from "../state/group-actions";
import { setGroupColor, ungroupOf } from "../state/group-style-actions";
import {
  dissolveSplit,
  dockTab,
  moveCell,
  resizeColumns,
  resizeRows,
  swapCells,
} from "../state/layout-actions";
import { splitTab, splitTabInner } from "../state/split-actions";
import {
  arrangeSplit,
  joinSplit,
  removeFromSplit,
  splitWithNew,
} from "../state/split-group-actions";
import { closeTab, openTab, renameTab, restartTab, updateTabStatus } from "../state/tab-actions";
import { currentState, type Listener, listeners } from "../state/terminal-store";

export function useTerminalTabs({ content = true }: { content?: boolean } = {}) {
  const [state, setLocalState] = useState<TerminalState>(currentState);

  useEffect(() => {
    setLocalState(currentState);
    const listener: Listener = (s) =>
      setLocalState((prev) => (!content && sameTerminalChrome(prev, s) ? prev : s));
    listeners.add(listener);
    listener(currentState);
    return () => {
      listeners.delete(listener);
    };
  }, [content]);

  const activeTab = useMemo(
    () => state.tabs.find((t) => t.id === state.activeTabId) ?? null,
    [state],
  );
  const inlineTabs = useMemo(
    () => activeInline(state.tabs, state.activeGroupId),
    [state.tabs, state.activeGroupId],
  );
  const detachedTabs = useMemo(() => state.tabs.filter((t) => t.detached), [state.tabs]);

  return {
    state,
    activeTab,
    inlineTabs,
    detachedTabs,
    openTab: useCallback(openTab, []),
    openFileTab: useCallback(openFileTab, []),
    updateFileContent: useCallback(updateFileContent, []),
    markFileClean: useCallback(markFileClean, []),
    closeTab: useCallback(closeTab, []),
    setActiveTab: useCallback(setActiveTab, []),
    updateTabStatus: useCallback(updateTabStatus, []),
    detachTab: useCallback(detachTab, []),
    splitTab: useCallback(splitTab, []),
    splitTabInner: useCallback(splitTabInner, []),
    splitWithNew: useCallback(splitWithNew, []),
    joinSplit: useCallback(joinSplit, []),
    arrangeSplit: useCallback(arrangeSplit, []),
    removeFromSplit: useCallback(removeFromSplit, []),
    setGroupColor: useCallback(setGroupColor, []),
    ungroupOf: useCallback(ungroupOf, []),
    moveCell: useCallback(moveCell, []),
    swapCells: useCallback(swapCells, []),
    dockTab: useCallback(dockTab, []),
    dissolveSplit: useCallback(dissolveSplit, []),
    switchGroup: useCallback(switchGroup, []),
    renameTab: useCallback(renameTab, []),
    closeGroup: useCallback(closeGroup, []),
    resizeColumns: useCallback(resizeColumns, []),
    resizeRows: useCallback(resizeRows, []),
    restartTab: useCallback(restartTab, []),
  };
}

/** Read-only view for the sidebar: groups + their terminals + management actions. */
export function useTerminalGroups() {
  const [state, setLocalState] = useState(currentState);
  useEffect(() => {
    const listener: Listener = (s) =>
      setLocalState((prev) => (sameTerminalChrome(prev, s) ? prev : s));
    listeners.add(listener);
    setLocalState(currentState);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return {
    groups: state.groups,
    activeGroupId: state.activeGroupId,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    switchGroup,
    closeGroup,
    setActiveTab,
    openTab,
    closeTab,
    renameTab,
    restartTab,
  };
}

export { startWorkspacePersistence } from "../state/terminal-store";

export { getTerminalTab } from "../state/terminal-store";

export { getTerminalTabs } from "../state/terminal-store";

export { overlaps } from "../model/layout/geometry";

export { normalizeLayout } from "../model/layout/normalize";

export { openTerminalAt } from "../state/tab-actions";

export { hideTestsTabs, showHiddenTestsTabs, openTestsTab } from "../state/test-view-actions";

export { openPluginTab } from "../state/plugin-tab-actions";

export { openAppTab, openAppTabHere } from "../state/app-tab-actions";

export { fillHoles } from "../model/layout/fill-holes";

export { syncProjectGroups } from "../state/group-actions";

export { detachTab } from "../state/detached-workspace";

export { attachGroup } from "../state/detached-workspace";

export { syncDetachedWorkspace } from "../state/detached-workspace";

export { hydrateDetachedGroup } from "../state/detached-workspace";

export { finalizeLayout } from "../model/layout/finalize";
