import { usePaneMenu } from "../hooks/use-pane-menu";
import { useTerminalBulkClose } from "../hooks/use-terminal-bulk-close";
import { openTestsTab, useTerminalTabs } from "../hooks/use-terminal-tabs";
import { inAnyGroup } from "../model/layout/split-groups";
import type { ChatViewMode } from "../shared/agent-events";
import { TerminalPaneContextMenu } from "./terminal-pane-context-menu";

interface Props {
  workspace: ReturnType<typeof useTerminalTabs>;
  menu: ReturnType<typeof usePaneMenu>;
  bulk: ReturnType<typeof useTerminalBulkClose>;
  zoomedTabId: string | null;
  setZoomedTabId: (update: (id: string | null) => string | null) => void;
  setRenamingTabId: (id: string | null) => void;
  paneModeOf: (id: string) => ChatViewMode;
  setPaneMode: (id: string, mode: ChatViewMode) => void;
}
export function WorkspacePaneMenu({
  workspace,
  menu,
  bulk,
  zoomedTabId,
  setZoomedTabId,
  setRenamingTabId,
  paneModeOf,
  setPaneMode,
}: Props) {
  const { state, inlineTabs, splitTab, closeTab, joinSplit, removeFromSplit } = workspace;
  const { paneMenu, setPaneMenu, paneEdit } = menu;
  // Loose open tab (in no split group) other than the one on screen
  const canJoin = (id: string) =>
    id !== state.activeTabId && inlineTabs.some((t) => t.id === id) && !inAnyGroup(state, id);
  return (
    <>
      {/* Pane / tab right-click menu */}
      {paneMenu && (
        <TerminalPaneContextMenu
          edit={paneEdit(paneMenu.tabId)}
          x={paneMenu.x}
          y={paneMenu.y}
          canZoom={!!state.layout}
          zoomed={zoomedTabId === paneMenu.tabId}
          onRename={() => setRenamingTabId(paneMenu.tabId)}
          onSplitRight={() => splitTab(paneMenu.tabId, "vertical")}
          onSplitDown={() => splitTab(paneMenu.tabId, "horizontal")}
          onJoinSplit={canJoin(paneMenu.tabId) ? () => joinSplit(paneMenu.tabId) : undefined}
          onRemoveFromSplit={
            state.layout?.cells.some((c) => c.tabId === paneMenu.tabId)
              ? () => removeFromSplit(paneMenu.tabId)
              : undefined
          }
          onZoom={() => setZoomedTabId((z) => (z === paneMenu.tabId ? null : paneMenu.tabId))}
          onClose={() => closeTab(paneMenu.tabId)}
          onCloseOthers={() => bulk.closeOthers(paneMenu.tabId)}
          canCloseOthers={bulk.hasOthers(paneMenu.tabId)}
          onCloseAll={bulk.closeAll}
          canCloseAll={bulk.count > 0}
          isAgent={state.tabs.find((t) => t.id === paneMenu.tabId)?.isAgent}
          onOpenTestBrowser={
            state.tabs.find((t) => t.id === paneMenu.tabId)?.kind
              ? undefined
              : () => {
                  const source = state.tabs.find((t) => t.id === paneMenu.tabId);
                  if (source) {
                    openTestsTab(source.sessionId);
                  }
                }
          }
          viewMode={paneModeOf(paneMenu.tabId)}
          onToggleView={() => {
            setPaneMode(paneMenu.tabId, paneModeOf(paneMenu.tabId) === "tui" ? "chat" : "tui");
          }}
          onCloseMenu={() => setPaneMenu(null)}
        />
      )}
    </>
  );
}
